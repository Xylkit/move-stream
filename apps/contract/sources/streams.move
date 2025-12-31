module xylkit::streams {
    use aptos_std::smart_table::{Self, SmartTable};
    use aptos_framework::timestamp;
    use std::type_info::TypeInfo;
    use std::vector;
    use std::bcs;
    use aptos_std::aptos_hash;

    friend xylkit::drips;

    // ═══════════════════════════════════════════════════════════════════════════════
     // ═══════════════════════════════════════════════════════════════════════════════

    /// Maximum number of streams receivers of a single account
    const MAX_STREAMS_RECEIVERS: u64 = 100;

    /// Additional decimals for all amt_per_sec values
    const AMT_PER_SEC_EXTRA_DECIMALS: u8 = 9;

    /// Multiplier for all amt_per_sec values (10^AMT_PER_SEC_EXTRA_DECIMALS)
    const AMT_PER_SEC_MULTIPLIER: u256 = 1_000_000_000;

    /// Maximum streams balance (2^127 - 1)
    const MAX_STREAMS_BALANCE: u128 = 170141183460469231731687303715884105727;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              ERROR CODES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Too many streams receivers (max 100)
    const E_TOO_MANY_RECEIVERS: u64 = 1;
    /// Streams receivers not sorted by account_id then config
    const E_RECEIVERS_NOT_SORTED: u64 = 2;
    /// Stream receiver amt_per_sec below minimum (1 token per cycle)
    const E_AMT_PER_SEC_TOO_LOW: u64 = 3;
    /// Cycle length must be greater than 1
    const E_CYCLE_SECS_TOO_LOW: u64 = 4;
    /// Storage already initialized
    const E_ALREADY_INITIALIZED: u64 = 5;
    /// Invalid streams receivers list (hash mismatch)
    const E_INVALID_STREAMS_RECEIVERS: u64 = 6;
    /// Invalid streams history (hash mismatch)
    const E_INVALID_STREAMS_HISTORY: u64 = 7;
    /// History entry has both hash and receivers (must have one or the other)
    const E_ENTRY_WITH_HASH_AND_RECEIVERS: u64 = 8;
    /// Timestamp is before the last streams update
    const E_TIMESTAMP_BEFORE_UPDATE: u64 = 9;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              STORAGE & TYPES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Global storage for all streams state, stored at @xylkit
    struct StreamsStorage has key {
        /// Cycle length in seconds (set once at initialization, must be > 1)
        cycle_secs: u64,
        /// Minimum amt_per_sec: 1 token per cycle = ceil(AMT_PER_SEC_MULTIPLIER / cycle_secs)
        min_amt_per_sec: u256,
        /// All account states
        states: SmartTable<StreamsStateKey, StreamsState>
    }

    /// Composite key for nested mapping: token_type -> account_id -> state
    struct StreamsStateKey has copy, drop, store {
        token_type: TypeInfo,
        account_id: u256
    }

    /// Per-account streams state
    struct StreamsState has store {
        /// Hash of streams history for squeeze validation
        streams_history_hash: vector<u8>,
        /// Hash of current streams receivers list
        streams_hash: vector<u8>,
        /// Next cycle that can be received
        next_receivable_cycle: u64,
        /// Time when streams were last configured
        update_time: u64,
        /// When funds will run out
        max_end: u64,
        /// Balance snapshot at last update
        balance: u128,
        /// Number of configs seen in current cycle (for squeeze)
        curr_cycle_configs: u64,
        /// Next squeezable timestamps: (sender_account_id, config_index) -> timestamp
        next_squeezed: SmartTable<NextSqueezedKey, u64>,
        /// Amount deltas per cycle: cycle -> AmtDelta
        amt_deltas: SmartTable<u64, AmtDelta>
    }

    /// Key for next_squeezed mapping
    struct NextSqueezedKey has copy, drop, store {
        sender_account_id: u256,
        config_index: u64
    }

    /// Delta amounts applied to cycles
    struct AmtDelta has copy, drop, store {
        this_cycle: i128,
        next_cycle: i128
    }

    /// Stream receiver configuration
    struct StreamReceiver has copy, drop, store {
        account_id: u256,
        config: StreamConfig
    }

    /// Stream configuration settings
    struct StreamConfig has copy, drop, store {
        stream_id: u64,
        amt_per_sec: u256,
        start: u64,
        duration: u64
    }

    /// History entry for squeezing
    struct StreamsHistory has copy, drop, store {
        streams_hash: vector<u8>,
        receivers: vector<StreamReceiver>,
        update_time: u64,
        max_end: u64
    }

    /// Preprocessed stream config for balance calculations
    struct ProcessedConfig has copy, drop, store {
        amt_per_sec: u256,
        start: u64,
        end: u64
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Initialize streams storage at @xylkit with configurable cycle length
    /// `cycle_secs`: Length of each cycle in seconds (must be > 1)
    ///   - Low value: funds available faster, but more cycles to process
    ///   - High value: cheaper receiving, but longer fund lock-up
    public entry fun initialize(account: &signer, cycle_secs: u64) {
        let addr = std::signer::address_of(account);
        assert!(addr == @xylkit, 0);
        assert!(!exists<StreamsStorage>(addr), E_ALREADY_INITIALIZED);
        assert!(cycle_secs > 1, E_CYCLE_SECS_TOO_LOW);

        // min_amt_per_sec = ceil(AMT_PER_SEC_MULTIPLIER / cycle_secs)
        let min_amt_per_sec =
            (AMT_PER_SEC_MULTIPLIER + (cycle_secs as u256) - 1) / (cycle_secs as u256);

        move_to(
            account,
            StreamsStorage { cycle_secs, min_amt_per_sec, states: smart_table::new() }
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              CORE UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns current timestamp
    fun curr_timestamp(): u64 {
        timestamp::now_seconds()
    }

    /// Returns the cycle containing the given timestamp
    /// Note: There can never be cycle 0 (timestamp / cycle_secs + 1)
    fun cycle_of(ts: u64): u64 acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        ts / storage.cycle_secs + 1
    }

    /// Returns the start timestamp of the current cycle
    fun curr_cycle_start(): u64 acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        let curr_ts = curr_timestamp();
        curr_ts - (curr_ts % storage.cycle_secs)
    }

    /// Returns the configured cycle length
    fun get_cycle_secs(): u64 acquires StreamsStorage {
        borrow_global<StreamsStorage>(@xylkit).cycle_secs
    }

    /// Returns the minimum amt_per_sec for this deployment
    fun get_min_amt_per_sec(): u256 acquires StreamsStorage {
        borrow_global<StreamsStorage>(@xylkit).min_amt_per_sec
    }

    /// Calculates the amount streamed over a time range
    /// Uses: floor(end × rate) - floor(start × rate)
    fun streamed_amt(amt_per_sec: u256, start: u64, end: u64): u256 {
        if (end <= start) {
            return 0
        };
        let amt_end = ((end as u256) * amt_per_sec) / AMT_PER_SEC_MULTIPLIER;
        let amt_start = ((start as u256) * amt_per_sec) / AMT_PER_SEC_MULTIPLIER;
        amt_end - amt_start
    }

    /// Calculates the time range in which a receiver is streamed to, capped to a window
    fun stream_range(
        config: &StreamConfig,
        update_time: u64,
        max_end: u64,
        start_cap: u64,
        end_cap: u64
    ): (u64, u64) {
        let stream_start =
            if (config.start == 0) {
                update_time
            } else {
                config.start
            };
        let stream_end = stream_start + config.duration;

        // If duration is 0 (forever) or exceeds max_end, cap to max_end
        if (stream_end == stream_start || stream_end > max_end) {
            stream_end = max_end
        };

        let start = max_u64(stream_start, start_cap);
        let end = max_u64(min_u64(stream_end, end_cap), start);

        (start, end)
    }

    /// Calculates the time range in the future in which a receiver will be streamed to
    fun stream_range_in_future(
        receiver: &StreamReceiver, update_time: u64, max_end: u64
    ): (u64, u64) {
        stream_range(
            &receiver.config,
            update_time,
            max_end,
            curr_timestamp(),
            MAX_U64
        )
    }

    /// Checks if receivers are properly ordered
    /// First by account_id, then by config (stream_id, amt_per_sec, start, duration)
    fun is_ordered(prev: &StreamReceiver, next: &StreamReceiver): bool {
        if (prev.account_id != next.account_id) {
            return prev.account_id < next.account_id
        };
        // Same account_id: compare configs lexicographically
        config_lt(&prev.config, &next.config)
    }

    /// Config less-than comparison
    /// Compares as if packed: stream_id | amt_per_sec | start | duration
    fun config_lt(a: &StreamConfig, b: &StreamConfig): bool {
        if (a.stream_id != b.stream_id) {
            return a.stream_id < b.stream_id
        };
        if (a.amt_per_sec != b.amt_per_sec) {
            return a.amt_per_sec < b.amt_per_sec
        };
        if (a.start != b.start) {
            return a.start < b.start
        };
        a.duration < b.duration
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    inline fun max_u64(a: u64, b: u64): u64 {
        if (a > b) { a }
        else { b }
    }

    inline fun min_u64(a: u64, b: u64): u64 {
        if (a < b) { a }
        else { b }
    }

    /// Helper to process cycles and accumulate received amounts
    fun process_cycles(
        state: &StreamsState,
        from_cycle: u64,
        to_cycle: u64,
        received_amt: u128,
        amt_per_cycle: i128
    ): (u128, i128) {
        let cycle = from_cycle;
        let acc_received = received_amt;
        let acc_rate = amt_per_cycle;

        while (cycle < to_cycle) {
            if (state.amt_deltas.contains(cycle)) {
                let delta = state.amt_deltas.borrow(cycle);
                acc_rate += delta.this_cycle;
                acc_received +=(acc_rate as u128);
                acc_rate += delta.next_cycle;
            } else {
                // No delta for this cycle, just accumulate current rate
                acc_received +=(acc_rate as u128);
            };
            cycle += 1;
        };

        (acc_received, acc_rate)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                         HASHING & CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Calculates the hash of the streams configuration
    /// Returns empty vector if receivers is empty, otherwise blake2b_256 hash
    public fun hash_streams(receivers: &vector<StreamReceiver>): vector<u8> {
        if (receivers.length() == 0) {
            return vector::empty<u8>()
        };
        aptos_hash::blake2b_256(bcs::to_bytes(receivers))
    }

    /// Calculates the hash of the streams history after configuration update
    /// The history hash forms a chain: each new config hashes with the previous history hash
    public fun hash_streams_history(
        old_streams_history_hash: &vector<u8>,
        streams_hash: &vector<u8>,
        update_time: u64,
        max_end: u64
    ): vector<u8> {
        let data = vector::empty<u8>();
        data.append(*old_streams_history_hash);
        data.append(*streams_hash);
        data.append(bcs::to_bytes(&update_time));
        data.append(bcs::to_bytes(&max_end));
        aptos_hash::blake2b_256(data)
    }

    /// Builds a preprocessed list of stream configurations from receivers
    /// Validates sorting, deduplication, and amt_per_sec requirements
    /// Skips expired streams (where start == end after range calculation)
    fun build_configs(
        receivers: &vector<StreamReceiver>
    ): vector<ProcessedConfig> acquires StreamsStorage {
        let len = receivers.length();
        assert!(len <= MAX_STREAMS_RECEIVERS, E_TOO_MANY_RECEIVERS);

        let configs = vector::empty<ProcessedConfig>();
        let min_amt = get_min_amt_per_sec();
        let curr_ts = curr_timestamp();

        let i = 0;
        while (i < len) {
            let receiver = receivers.borrow(i);

            if (i > 0) {
                let prev = receivers.borrow(i - 1);
                assert!(is_ordered(prev, receiver), E_RECEIVERS_NOT_SORTED);
            };

            assert!(receiver.config.amt_per_sec >= min_amt, E_AMT_PER_SEC_TOO_LOW);

            let (start, end) = stream_range_in_future(receiver, curr_ts, MAX_U64);

            // Skip expired streams
            if (start != end) {
                configs.push_back(
                    ProcessedConfig { amt_per_sec: receiver.config.amt_per_sec, start, end }
                );
            };

            i += 1;
        };

        configs
    }

    /// Extracts config values from the preprocessed configs vector
    fun get_config(configs: &vector<ProcessedConfig>, idx: u64): (u256, u64, u64) {
        let config = configs.borrow(idx);
        (config.amt_per_sec, config.start, config.end)
    }

    /// Verifies that the provided receivers list matches the stored hash
    fun verify_streams_receivers(
        receivers: &vector<StreamReceiver>, state: &StreamsState
    ) {
        let provided_hash = hash_streams(receivers);
        assert!(provided_hash == state.streams_hash, E_INVALID_STREAMS_RECEIVERS);
    }

    /// Verifies a streams history chain and returns the history hashes
    /// Each entry's hash is computed and chained to verify the final hash matches
    /// Returns vector of history hashes valid for squeezing each entry
    fun verify_streams_history(
        history_hash: vector<u8>,
        streams_history: &vector<StreamsHistory>,
        final_history_hash: &vector<u8>
    ): vector<vector<u8>> {
        let len = streams_history.length();
        let history_hashes = vector::empty<vector<u8>>();
        let current_hash = history_hash;

        let i = 0;
        while (i < len) {
            let entry = streams_history.borrow(i);

            let streams_hash =
                if (entry.receivers.length() != 0) {
                    // Entry has receivers so hash MUST stay empty
                    assert!(
                        entry.streams_hash.length() == 0,
                        E_ENTRY_WITH_HASH_AND_RECEIVERS
                    );
                    hash_streams(&entry.receivers)
                } else {
                    // Entry has no receivers (signals receiver has no stream in entry so skips)
                    entry.streams_hash
                };

            // Store hash valid BEFORE this entry
            history_hashes.push_back(current_hash);

            current_hash = hash_streams_history(
                &current_hash,
                &streams_hash,
                entry.update_time,
                entry.max_end
            );

            i += 1;
        };

        assert!(current_hash == *final_history_hash, E_INVALID_STREAMS_HISTORY);

        history_hashes
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                            DELTA ACCOUNTING
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Adds delta of funds received by an account at a given timestamp
    /// To set a delta on a specific timestamp it must be introduced in two cycles.
    /// The math follows _streamedAmt logic for consistency.
    fun add_delta(
        amt_deltas: &mut SmartTable<u64, AmtDelta>,
        timestamp: u64,
        amt_per_sec: i256
    ) acquires StreamsStorage {
        let cycle_secs = get_cycle_secs();
        let multiplier = (AMT_PER_SEC_MULTIPLIER as i256);

        let full_cycle = ((cycle_secs as i256) * amt_per_sec) / multiplier;
        let next_cycle = (((timestamp % cycle_secs) as i256) * amt_per_sec) / multiplier;

        let cycle = cycle_of(timestamp);

        if (!amt_deltas.contains(cycle)) {
            amt_deltas.add(cycle, AmtDelta { this_cycle: 0, next_cycle: 0 });
        };

        let delta = amt_deltas.borrow_mut(cycle);

        // TODO: Check Over/underflow are fine, if guaranteed to be fixed by matching call from add_delta_range
        delta.this_cycle +=((full_cycle - next_cycle) as i128);
        delta.next_cycle +=(next_cycle as i128);
    }

    /// Adds funds received by an account in a given time range
    /// `state`: The account state
    /// `start`: The timestamp from which the delta takes effect
    /// `end`: The timestamp until which the delta takes effect
    /// `amt_per_sec`: The streaming rate (can be negative to remove)
    fun add_delta_range(
        state: &mut StreamsState,
        start: u64,
        end: u64,
        amt_per_sec: i256
    ) acquires StreamsStorage {
        if (start == end) { return };
        add_delta(&mut state.amt_deltas, start, amt_per_sec);
        add_delta(&mut state.amt_deltas, end, 0 - amt_per_sec);
    }

    /// Applies the effects of streams configuration changes on receivers' states
    /// Uses a two-pointer merge approach to efficiently diff old vs new receivers
    /// `states`: The streams states table for the token
    /// `token_type`: The token type being streamed
    /// `curr_receivers`: Current receivers list (empty if first update)
    /// `last_update`: Last time sender updated streams (0 if first update)
    /// `curr_max_end`: Max end time from last update
    /// `new_receivers`: New receivers list to set
    /// `new_max_end`: Max end time for new configuration
    fun update_receiver_states(
        states: &mut SmartTable<StreamsStateKey, StreamsState>,
        token_type: std::type_info::TypeInfo,
        curr_receivers: &vector<StreamReceiver>,
        last_update: u64,
        curr_max_end: u64,
        new_receivers: &vector<StreamReceiver>,
        new_max_end: u64
    ) acquires StreamsStorage {
        let curr_len = curr_receivers.length();
        let new_len = new_receivers.length();
        let curr_idx: u64 = 0;
        let new_idx: u64 = 0;

        loop {
            let pick_curr = curr_idx < curr_len;
            let pick_new = new_idx < new_len;

            // Get current receiver if available
            let curr_recv =
                if (pick_curr) {
                    curr_receivers[curr_idx]
                } else {
                    StreamReceiver {
                        account_id: 0,
                        config: StreamConfig {
                            stream_id: 0,
                            amt_per_sec: 0,
                            start: 0,
                            duration: 0
                        }
                    }
                };

            // Get new receiver if available
            let new_recv =
                if (pick_new) {
                    new_receivers[new_idx]
                } else {
                    StreamReceiver {
                        account_id: 0,
                        config: StreamConfig {
                            stream_id: 0,
                            amt_per_sec: 0,
                            start: 0,
                            duration: 0
                        }
                    }
                };

            // Limit picking both to situations when they differ only by time
            if (pick_curr && pick_new) {
                if (curr_recv.account_id != new_recv.account_id
                    || curr_recv.config.amt_per_sec != new_recv.config.amt_per_sec) {
                    pick_curr = is_ordered(&curr_recv, &new_recv);
                    pick_new = !pick_curr;
                };
            };

            if (pick_curr && pick_new) {
                // Shift existing stream to fulfil new configuration
                let state_key =
                    StreamsStateKey { token_type, account_id: curr_recv.account_id };
                ensure_state_exists(states, state_key);
                let state = states.borrow_mut(state_key);

                let (curr_start, curr_end) =
                    stream_range(
                        &curr_recv.config,
                        last_update,
                        curr_max_end,
                        curr_timestamp(),
                        MAX_U64
                    );
                let (new_start, new_end) =
                    stream_range(
                        &new_recv.config,
                        curr_timestamp(),
                        new_max_end,
                        curr_timestamp(),
                        MAX_U64
                    );

                let amt_per_sec = (curr_recv.config.amt_per_sec as i256);

                // Optimization: instead of removing old range and adding new range,
                // just adjust the start and end deltas
                // TODO: Explain how this works much clearly
                add_delta_range(state, curr_start, new_start, 0 - amt_per_sec);
                add_delta_range(state, curr_end, new_end, amt_per_sec);

                // Ensure account receives updated cycles
                let curr_start_cycle = cycle_of(curr_start);
                let new_start_cycle = cycle_of(new_start);
                if (curr_start_cycle > new_start_cycle
                    && state.next_receivable_cycle > new_start_cycle) {
                    state.next_receivable_cycle = new_start_cycle;
                };

                curr_idx += 1;
                new_idx += 1;
            } else if (pick_curr) {
                // Remove an existing stream
                let state_key =
                    StreamsStateKey { token_type, account_id: curr_recv.account_id };
                ensure_state_exists(states, state_key);
                let state = states.borrow_mut(state_key);

                let (start, end) =
                    stream_range(
                        &curr_recv.config,
                        last_update,
                        curr_max_end,
                        curr_timestamp(),
                        MAX_U64
                    );
                let amt_per_sec = (curr_recv.config.amt_per_sec as i256);
                add_delta_range(state, start, end, 0 - amt_per_sec);

                curr_idx += 1;
            } else if (pick_new) {
                // Create a new stream
                let state_key =
                    StreamsStateKey { token_type, account_id: new_recv.account_id };
                ensure_state_exists(states, state_key);
                let state = states.borrow_mut(state_key);

                let (start, end) =
                    stream_range(
                        &new_recv.config,
                        curr_timestamp(),
                        new_max_end,
                        curr_timestamp(),
                        MAX_U64
                    );
                let amt_per_sec = (new_recv.config.amt_per_sec as i256);
                add_delta_range(state, start, end, amt_per_sec);

                // Ensure account receives updated cycles
                let start_cycle = cycle_of(start);
                let next_receivable = state.next_receivable_cycle;
                if (next_receivable == 0 || next_receivable > start_cycle) {
                    state.next_receivable_cycle = start_cycle;
                };

                new_idx += 1;
            } else { break };
        };
    }

    /// Ensures a StreamsState exists for the given key, creating if needed
    fun ensure_state_exists(
        states: &mut SmartTable<StreamsStateKey, StreamsState>, key: StreamsStateKey
    ) {
        if (!states.contains(key)) {
            states.add(
                key,
                StreamsState {
                    streams_history_hash: vector::empty(),
                    streams_hash: vector::empty(),
                    next_receivable_cycle: 0,
                    update_time: 0,
                    max_end: 0,
                    balance: 0,
                    curr_cycle_configs: 0,
                    next_squeezed: smart_table::new(),
                    amt_deltas: smart_table::new()
                }
            );
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                        BALANCE & MAX END CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns the account's streams balance at a given timestamp
    /// `token_type`: The token type being streamed
    /// `account_id`: The account ID
    /// `curr_receivers`: Current receivers list (must match stored hash)
    /// `timestamp`: The timestamp to calculate balance at (must be >= update_time)
    public fun balance_at(
        token_type: std::type_info::TypeInfo,
        account_id: u256,
        curr_receivers: &vector<StreamReceiver>,
        timestamp: u64
    ): u128 acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        let state_key = StreamsStateKey { token_type, account_id };

        // Non-existent account = 0 balance
        if (!storage.states.contains(state_key)) {
            return 0
        };

        let state = storage.states.borrow(state_key);
        assert!(timestamp >= state.update_time, E_TIMESTAMP_BEFORE_UPDATE);
        verify_streams_receivers(curr_receivers, state);

        calc_balance(
            state.balance,
            state.update_time,
            state.max_end,
            curr_receivers,
            timestamp
        )
    }

    /// Calculates the streams balance at a given timestamp
    /// Subtracts all amounts streamed from last_update to timestamp
    /// `last_balance`: Balance snapshot at last update
    /// `last_update`: Timestamp of last update
    /// `max_end`: Maximum end time of streaming
    /// `receivers`: Current receivers list
    /// `timestamp`: Target timestamp for balance calculation
    fun calc_balance(
        last_balance: u128,
        last_update: u64,
        max_end: u64,
        receivers: &vector<StreamReceiver>,
        timestamp: u64
    ): u128 {
        let balance = (last_balance as u256);
        let len = receivers.length();
        let i = 0;

        while (i < len) {
            let receiver = receivers.borrow(i);
            let (start, end) =
                stream_range(
                    &receiver.config,
                    last_update,
                    max_end,
                    last_update,
                    timestamp
                );
            let spent = streamed_amt(receiver.config.amt_per_sec, start, end);
            balance -= spent;
            i += 1;
        };

        (balance as u128)
    }

    /// Calculates the maximum end time when all streams stop due to funds running out
    /// Uses binary search between current timestamp and max u32
    /// `balance`: The balance when streaming starts
    /// `receivers`: The list of stream receivers
    /// `hint1`: Optional hint for binary search optimization (pass 0 to ignore)
    /// `hint2`: Optional hint for binary search optimization (pass 0 to ignore)
    public fun calc_max_end(
        balance: u128,
        receivers: &vector<StreamReceiver>,
        hint1: u64,
        hint2: u64
    ): u64 acquires StreamsStorage {
        let configs = build_configs(receivers);
        let configs_len = configs.length();

        // Using better variable names per Notes.md
        let min_guaranteed_end = curr_timestamp();

        // No configs or zero balance = end now
        if (configs_len == 0 || balance == 0) {
            return min_guaranteed_end
        };

        let max_possible_end = MAX_U64;
        // Balance covers everything forever
        if (is_balance_enough(balance, &configs, max_possible_end)) {
            return max_possible_end
        };

        // Apply hints to narrow search range
        let enough_end = min_guaranteed_end;
        let not_enough_end = max_possible_end;

        if (hint1 > enough_end && hint1 < not_enough_end) {
            if (is_balance_enough(balance, &configs, hint1)) {
                enough_end = hint1;
            } else {
                not_enough_end = hint1;
            };
        };

        if (hint2 > enough_end && hint2 < not_enough_end) {
            if (is_balance_enough(balance, &configs, hint2)) {
                enough_end = hint2;
            } else {
                not_enough_end = hint2;
            };
        };

        // Binary search for exact end time
        loop {
            let mid = (enough_end + not_enough_end) / 2;
            if (mid == enough_end) {
                return mid
            };
            if (is_balance_enough(balance, &configs, mid)) {
                enough_end = mid;
            } else {
                not_enough_end = mid;
            };
        }
    }

    /// Checks if balance is enough to cover all streams until max_end
    /// `balance`: The starting balance
    /// `configs`: Preprocessed stream configurations
    /// `max_end`: The end time to check against
    fun is_balance_enough(
        balance: u128, configs: &vector<ProcessedConfig>, max_end: u64
    ): bool {
        let spent: u256 = 0;
        let balance_u256 = (balance as u256);
        let len = configs.length();
        let i = 0;

        while (i < len) {
            let (amt_per_sec, start, end) = get_config(configs, i);

            // Stream hasn't started yet at max_end
            if (max_end <= start) {
                i += 1;
                continue
            };

            // Cap end to max_end
            let capped_end = if (end > max_end) {
                max_end
            } else { end };

            spent += streamed_amt(amt_per_sec, start, capped_end);

            // Early exit if already over budget
            if (spent > balance_u256) {
                return false
            };

            i += 1;
        };

        true
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                            RECEIVING STREAMS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns (from_cycle, to_cycle) range for receivable streams
    fun receivable_streams_cycles_range(
        token_type: std::type_info::TypeInfo, account_id: u256
    ): (u64, u64) acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        let state_key = StreamsStateKey { token_type, account_id };

        if (!storage.states.contains(state_key)) {
            return (0, 0)
        };

        let from_cycle = storage.states.borrow(state_key).next_receivable_cycle;
        let to_cycle = cycle_of(curr_timestamp());

        // Nothing to receive if from_cycle is 0 or ahead of current cycle
        if (from_cycle == 0 || to_cycle < from_cycle) {
            (from_cycle, from_cycle)
        } else {
            (from_cycle, to_cycle)
        }
    }

    /// Calculate effects of calling `receive_streams` with the given parameters
    /// `token_type`: The token type being streamed
    /// `account_id`: The account ID
    /// `max_cycles`: Maximum number of cycles to process
    /// Returns: (received_amt, receivable_cycles, from_cycle, to_cycle, amt_per_cycle)
    ///   - received_amt: The amount that would be received
    ///   - receivable_cycles: Cycles still receivable after the call
    ///   - from_cycle: Starting cycle of reception
    ///   - to_cycle: Ending cycle of reception
    ///   - amt_per_cycle: Running amount per cycle at to_cycle (for delta adjustment)
    public fun receive_streams_result(
        token_type: std::type_info::TypeInfo, account_id: u256, max_cycles: u64
    ): (u128, u64, u64, u64, i128) acquires StreamsStorage {
        let (from_cycle, to_cycle_raw) =
            receivable_streams_cycles_range(token_type, account_id);

        // Cap cycles to max_cycles
        let (receivable_cycles, to_cycle) =
            if (to_cycle_raw - from_cycle > max_cycles) {
                let remaining = to_cycle_raw - from_cycle - max_cycles;
                (remaining, to_cycle_raw - remaining)
            } else {
                (0, to_cycle_raw)
            };

        let storage = borrow_global<StreamsStorage>(@xylkit);
        let state_key = StreamsStateKey { token_type, account_id };

        let received_amt: u128 = 0;
        let amt_per_cycle: i128 = 0;

        // Only process if state exists and there are cycles to process
        let (final_received_amt, final_amt_per_cycle) =
            if (storage.states.contains(state_key) && from_cycle < to_cycle) {
                let state = storage.states.borrow(state_key);
                process_cycles(
                    state,
                    from_cycle,
                    to_cycle,
                    received_amt,
                    amt_per_cycle
                )
            } else {
                (received_amt, amt_per_cycle)
            };

        (
            final_received_amt,
            receivable_cycles,
            from_cycle,
            to_cycle,
            final_amt_per_cycle
        )
    }

    /// Receive streams from unreceived cycles of the account.
    /// Received streams cycles won't need to be analyzed ever again.\
    /// `token_type`: The token type being streamed\
    /// `account_id`: The account ID\
    /// `max_cycles`: Maximum number of cycles to process
    ///   - Low value: cheaper but may not cover many cycles
    ///   - High value: may be too expensive for single transaction
    ///
    /// Returns: `received_amt` - The amount received
    public(friend) fun receive_streams(
        token_type: std::type_info::TypeInfo, account_id: u256, max_cycles: u64
    ): u128 acquires StreamsStorage {
        let (received_amt, _receivable_cycles, from_cycle, to_cycle, final_amt_per_cycle) =
            receive_streams_result(token_type, account_id, max_cycles);

        if (from_cycle != to_cycle) {
            let storage = borrow_global_mut<StreamsStorage>(@xylkit);
            let state_key = StreamsStateKey { token_type, account_id };

            ensure_state_exists(&mut storage.states, state_key);
            let state = storage.states.borrow_mut(state_key);

            // Update next receivable cycle
            state.next_receivable_cycle = to_cycle;

            // Delete processed cycle deltas
            let cycle = from_cycle;
            while (cycle < to_cycle) {
                if (state.amt_deltas.contains(cycle)) {
                    state.amt_deltas.remove(cycle);
                };
                cycle += 1;
            };

            // The next cycle delta must be relative to the last received cycle (which got zeroed)
            // In other words, the next cycle delta must be an absolute value
            if (final_amt_per_cycle != 0) {
                if (!state.amt_deltas.contains(to_cycle)) {
                    state.amt_deltas.add(
                        to_cycle, AmtDelta { this_cycle: 0, next_cycle: 0 }
                    );
                };
                let delta = state.amt_deltas.borrow_mut(to_cycle);
                delta.this_cycle += final_amt_per_cycle;
            };
        };

        received_amt
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                          SQUEEZING & SET STREAMS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Squeeze streams from the currently running cycle from a single sender.\
    /// It doesn't receive streams from finished cycles - use `receive_streams` for that.\
    /// Squeezed funds won't be received in subsequent calls to `squeeze_streams` or `receive_streams`.\
    /// Only funds streamed before current timestamp can be squeezed.
    ///
    /// `account_id`: The ID of the account receiving streams to squeeze funds for\
    /// `token_type`: The token type being streamed\
    /// `sender_id`: The ID of the streaming account to squeeze funds from\
    /// `history_hash`: The sender's history hash valid right before `streams_history`\
    /// `streams_history`: The sequence of the sender's streams configurations
    ///
    /// Returns: `amt` - The squeezed amount
    public(friend) fun squeeze_streams(
        account_id: u256,
        token_type: std::type_info::TypeInfo,
        sender_id: u256,
        history_hash: vector<u8>,
        streams_history: &vector<StreamsHistory>
    ): u128 acquires StreamsStorage {
        let (amt, squeezed_indexes, _history_hashes, curr_cycle_configs) =
            squeeze_streams_result(
                account_id,
                token_type,
                sender_id,
                history_hash,
                streams_history
            );

        let storage = borrow_global_mut<StreamsStorage>(@xylkit);
        let state_key = StreamsStateKey { token_type, account_id };
        ensure_state_exists(&mut storage.states, state_key);
        let state = storage.states.borrow_mut(state_key);

        let squeezed_len = squeezed_indexes.length();
        let i = 0;
        while (i < squeezed_len) {
            let idx = squeezed_indexes[i];
            let config_index = curr_cycle_configs - idx;
            let squeezed_key = NextSqueezedKey {
                sender_account_id: sender_id,
                config_index
            };
            if (state.next_squeezed.contains(squeezed_key)) {
                *state.next_squeezed.borrow_mut(squeezed_key) = curr_timestamp();
            } else {
                state.next_squeezed.add(squeezed_key, curr_timestamp());
            };
            i += 1;
        };

        // Apply negative delta to remove squeezed amount from current cycle
        // This prevents double-receiving via receive_streams
        if (amt > 0) {
            let cycle_start = curr_cycle_start();
            let neg_amt_per_sec = 0 - ((amt as i256) * (AMT_PER_SEC_MULTIPLIER as i256));
            add_delta_range(
                state,
                cycle_start,
                cycle_start + 1,
                neg_amt_per_sec
            );
        };

        amt
    }

    /// Calculate effects of calling `squeeze_streams` with the given parameters.
    ///
    /// `account_id`: The ID of the account receiving streams to squeeze funds for
    /// `token_type`: The token type being streamed
    /// `sender_id`: The ID of the streaming account to squeeze funds from
    /// `history_hash`: The sender's history hash valid right before `streams_history`
    /// `streams_history`: The sequence of the sender's streams configurations
    ///
    /// Returns:
    ///   - `amt`: The squeezed amount
    ///   - `squeezed_indexes`: Reverse indexes of squeezed history entries (oldest to newest)
    ///   - `history_hashes`: History hashes valid for squeezing each entry
    ///   - `curr_cycle_configs`: Number of sender's configs seen in current cycle
    public fun squeeze_streams_result(
        account_id: u256,
        token_type: std::type_info::TypeInfo,
        sender_id: u256,
        history_hash: vector<u8>,
        streams_history: &vector<StreamsHistory>
    ): (u128, vector<u64>, vector<vector<u8>>, u64) acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        let sender_key = StreamsStateKey { token_type, account_id: sender_id };

        // Get sender's final history hash for verification
        let final_history_hash =
            if (storage.states.contains(sender_key)) {
                storage.states.borrow(sender_key).streams_history_hash
            } else {
                vector::empty<u8>()
            };

        // Verify the history chain
        let history_hashes =
            verify_streams_history(
                history_hash,
                streams_history,
                &final_history_hash
            );

        // Determine how many configs to check in current cycle
        // If last update was not in current cycle, only the latest entry matters
        let curr_cycle_configs =
            if (storage.states.contains(sender_key)
                && storage.states.borrow(sender_key).update_time >= curr_cycle_start()) {
                storage.states.borrow(sender_key).curr_cycle_configs
            } else { 1 };

        // Get receiver's next_squeezed mapping
        let receiver_key = StreamsStateKey { token_type, account_id };

        let amt: u128 = 0;
        let squeezed_indexes = vector::empty<u64>();
        let squeeze_end_cap = curr_timestamp();
        let history_len = streams_history.length();

        // Process history entries from newest to oldest (up to curr_cycle_configs)
        let i: u64 = 1;
        while (i <= history_len && i <= curr_cycle_configs) {
            let entry_idx = history_len - i;
            let entry = streams_history.borrow(entry_idx);

            // Skip entries with no receivers
            if (entry.receivers.length() != 0) {
                // Get next_squeezed timestamp (0 if never squeezed)
                let next_squeezed_ts =
                    if (storage.states.contains(receiver_key)) {
                        let state = storage.states.borrow(receiver_key);
                        let key =
                            NextSqueezedKey {
                                sender_account_id: sender_id,
                                config_index: curr_cycle_configs - i
                            };
                        if (state.next_squeezed.contains(key)) {
                            *state.next_squeezed.borrow(key)
                        } else { 0 }
                    } else { 0 };

                // squeeze_start_cap = max(next_squeezed, curr_cycle_start, entry.update_time)
                let squeeze_start_cap =
                    max_u64(
                        max_u64(next_squeezed_ts, curr_cycle_start()),
                        entry.update_time
                    );

                // Only squeeze if there's a valid time range
                if (squeeze_start_cap < squeeze_end_cap) {
                    squeezed_indexes.push_back(i);
                    amt += squeezed_amt(
                        account_id,
                        entry,
                        squeeze_start_cap,
                        squeeze_end_cap
                    );
                };
            };

            // Next entry's end cap is this entry's update_time
            squeeze_end_cap = entry.update_time;
            i += 1;
        };

        // Reverse squeezed_indexes to be oldest-to-newest
        let reversed = vector::empty<u64>();
        let j = squeezed_indexes.length();
        while (j > 0) {
            j -= 1;
            reversed.push_back(squeezed_indexes[j]);
        };

        (amt, reversed, history_hashes, curr_cycle_configs)
    }

    /// Calculate the amount squeezable by an account from a single streams history entry.\
    /// `account_id`: The ID of the account to squeeze streams for\
    /// `history_entry`: The squeezed history entry\
    /// `squeeze_start_cap`: The squeezed time range start\
    /// `squeeze_end_cap`: The squeezed time range end
    ///
    /// Returns: `squeezed_amt` - The squeezed amount
    fun squeezed_amt(
        account_id: u256,
        history_entry: &StreamsHistory,
        squeeze_start_cap: u64,
        squeeze_end_cap: u64
    ): u128 {
        let receivers = &history_entry.receivers;
        let receivers_len = receivers.length();

        // Binary search for the first occurrence of account_id
        let idx: u64 = 0;
        let idx_cap = receivers_len;
        while (idx < idx_cap) {
            let idx_mid = (idx + idx_cap) / 2;
            if (receivers.borrow(idx_mid).account_id < account_id) {
                idx = idx_mid + 1;
            } else {
                idx_cap = idx_mid;
            };
        };

        let update_time = history_entry.update_time;
        let max_end = history_entry.max_end;
        let amt: u256 = 0;

        // Sum up all streams to this account_id
        while (idx < receivers_len) {
            let receiver = receivers.borrow(idx);
            if (receiver.account_id != account_id) { break };

            let (start, end) =
                stream_range(
                    &receiver.config,
                    update_time,
                    max_end,
                    squeeze_start_cap,
                    squeeze_end_cap
                );
            amt += streamed_amt(receiver.config.amt_per_sec, start, end);
            idx += 1;
        };

        (amt as u128)
    }

    /// Sets the account's streams configuration.\
    /// Main entry point to configure streams.
    ///
    /// `account_id`: The account ID\
    /// `token_type`: The token type being streamed\
    /// `curr_receivers`: Current streams receivers list (must match stored hash, empty if first update)\
    /// `balance_delta`: Balance change (positive to add funds, negative to withdraw)\
    /// `new_receivers`: New receivers list (must be sorted, deduplicated, no zero amt_per_sec)\
    /// `max_end_hint1`: Optional hint for binary search optimization (pass 0 to ignore)\
    /// `max_end_hint2`: Optional hint for binary search optimization (pass 0 to ignore)
    ///
    /// Returns: `real_balance_delta` - The actually applied balance change
    public(friend) fun set_streams(
        account_id: u256,
        token_type: std::type_info::TypeInfo,
        curr_receivers: &vector<StreamReceiver>,
        balance_delta: i128,
        new_receivers: &vector<StreamReceiver>,
        max_end_hint1: u64,
        max_end_hint2: u64
    ): i128 acquires StreamsStorage {
        let storage = borrow_global_mut<StreamsStorage>(@xylkit);
        let state_key = StreamsStateKey { token_type, account_id };
        ensure_state_exists(&mut storage.states, state_key);

        // Verify current receivers match stored hash
        {
            let state = storage.states.borrow(state_key);
            verify_streams_receivers(curr_receivers, state);
        };

        // Get current state values
        let (
            last_update,
            curr_max_end,
            stored_balance,
            old_history_hash,
            old_curr_cycle_configs
        ) = {
            let state = storage.states.borrow(state_key);
            (
                state.update_time,
                state.max_end,
                state.balance,
                state.streams_history_hash,
                state.curr_cycle_configs
            )
        };

        // Calculate current balance
        let curr_balance =
            calc_balance(
                stored_balance,
                last_update,
                curr_max_end,
                curr_receivers,
                curr_timestamp()
            );

        // Cap balance_delta at withdrawal of entire balance
        let real_balance_delta = balance_delta;
        if (real_balance_delta < 0 - (curr_balance as i128)) {
            real_balance_delta = 0 - (curr_balance as i128);
        };

        // Calculate new balance
        let new_balance =
            if (real_balance_delta >= 0) {
                curr_balance + (real_balance_delta as u128)
            } else {
                curr_balance - ((0 - real_balance_delta) as u128)
            };

        // Calculate new max_end
        let new_max_end =
            calc_max_end(
                new_balance,
                new_receivers,
                max_end_hint1,
                max_end_hint2
            );

        // Update receiver states (apply deltas)
        update_receiver_states(
            &mut storage.states,
            token_type,
            curr_receivers,
            last_update,
            curr_max_end,
            new_receivers,
            new_max_end
        );

        // Update sender state
        let state = storage.states.borrow_mut(state_key);
        let curr_ts = curr_timestamp();

        state.update_time = curr_ts;
        state.max_end = new_max_end;
        state.balance = new_balance;

        // Update curr_cycle_configs
        // If history exists and we crossed a cycle boundary, reset to 2
        // Otherwise increment
        if (old_history_hash.length() != 0
            && cycle_of(last_update) != cycle_of(curr_ts)) {
            state.curr_cycle_configs = 2;
        } else {
            state.curr_cycle_configs = old_curr_cycle_configs + 1;
        };

        // Update streams hash and history hash
        let new_streams_hash = hash_streams(new_receivers);
        state.streams_history_hash = hash_streams_history(
            &old_history_hash,
            &new_streams_hash,
            curr_ts,
            new_max_end
        );

        // Update streams_hash if changed
        if (new_streams_hash != state.streams_hash) {
            state.streams_hash = new_streams_hash;
        };

        real_balance_delta
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns the current streams state for an account
    /// 
    /// `account_id`: The account ID\
    /// `token_type`: The token type
    /// 
    /// Returns: (streams_hash, streams_history_hash, update_time, balance, max_end)
    public fun streams_state(
        account_id: u256, token_type: std::type_info::TypeInfo
    ): (vector<u8>, vector<u8>, u64, u128, u64) acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        let state_key = StreamsStateKey { token_type, account_id };

        if (!storage.states.contains(state_key)) {
            return (vector::empty<u8>(), vector::empty<u8>(), 0, 0, 0)
        };

        let state = storage.states.borrow(state_key);
        (
            state.streams_hash,
            state.streams_history_hash,
            state.update_time,
            state.balance,
            state.max_end
        )
    }
}

