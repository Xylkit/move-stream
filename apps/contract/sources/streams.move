module xylkit::streams {
    use aptos_std::smart_table::{Self, SmartTable};
    use aptos_framework::timestamp;
    use std::type_info::TypeInfo;
    use std::vector;
    use std::bcs;
    use aptos_std::aptos_hash;

    friend xylkit::drips;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
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
    // balance_at, calc_balance, calc_max_end, is_balance_enough

    // ═══════════════════════════════════════════════════════════════════════════════
    //                            RECEIVING STREAMS
    // ═══════════════════════════════════════════════════════════════════════════════
    // receive_streams, receive_streams_result, receivable_streams_cycles, receivable_streams_cycles_range

    // ═══════════════════════════════════════════════════════════════════════════════
    //                          SQUEEZING & SET STREAMS
    // ═══════════════════════════════════════════════════════════════════════════════
    // squeeze_streams, squeeze_streams_result, squeezed_amt, set_streams
}

