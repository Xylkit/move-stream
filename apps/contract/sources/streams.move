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

    const E_TOO_MANY_RECEIVERS: u64 = 1;
    const E_RECEIVERS_NOT_SORTED: u64 = 2;
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
        next_receivable_cycle: u32,
        /// Time when streams were last configured
        update_time: u32,
        /// When funds will run out
        max_end: u32,
        /// Balance snapshot at last update
        balance: u128,
        /// Number of configs seen in current cycle (for squeeze)
        curr_cycle_configs: u32,
        /// Next squeezable timestamps: (sender_account_id, config_index) -> timestamp
        next_squeezed: SmartTable<NextSqueezedKey, u32>,
        /// Amount deltas per cycle: cycle -> AmtDelta
        amt_deltas: SmartTable<u32, AmtDelta>
    }

    /// Key for next_squeezed mapping
    struct NextSqueezedKey has copy, drop, store {
        sender_account_id: u256,
        config_index: u32
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

    /// Stream configuration packed as:
    /// stream_id (32 bits) | amt_per_sec (160 bits) | start (32 bits) | duration (32 bits)
    struct StreamConfig has copy, drop, store {
        stream_id: u32,
        amt_per_sec: u256, // 160 bits in Solidity, u256 for safety
        start: u32,
        duration: u32
    }

    /// History entry for squeezing
    struct StreamsHistory has copy, drop, store {
        streams_hash: vector<u8>,
        receivers: vector<StreamReceiver>,
        update_time: u32,
        max_end: u32
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Initialize streams storage at @xylkit with configurable cycle length
    /// @param cycle_secs: Length of each cycle in seconds (must be > 1)
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

    /// Returns current timestamp as u32
    fun curr_timestamp(): u32 {
        (timestamp::now_seconds() as u32)
    }

    /// Returns the cycle containing the given timestamp
    /// Note: There can never be cycle 0 (timestamp / cycle_secs + 1)
    fun cycle_of(ts: u32): u32 acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        (((ts as u64) / storage.cycle_secs + 1) as u32)
    }

    /// Returns the start timestamp of the current cycle
    fun curr_cycle_start(): u32 acquires StreamsStorage {
        let storage = borrow_global<StreamsStorage>(@xylkit);
        let curr_ts = curr_timestamp();
        let cycle_secs = (storage.cycle_secs as u32);
        curr_ts - (curr_ts % cycle_secs)
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
                (config.start as u64)
            };
        let stream_end = stream_start + (config.duration as u64);

        // If duration is 0 (forever) or exceeds max_end, cap to max_end
        if (stream_end == stream_start || stream_end > max_end) {
            stream_end = max_end
        };

        let start = max_u64(stream_start, start_cap);
        let end = max_u64(min_u64(stream_end, end_cap), start);

        (start, end)
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
    // hash_streams, hash_streams_history, build_configs, get_config,
    // verify_streams_receivers, verify_streams_history

    // ═══════════════════════════════════════════════════════════════════════════════
    //                            DELTA ACCOUNTING
    // ═══════════════════════════════════════════════════════════════════════════════
    // add_delta, add_delta_range, update_receiver_states, stream_range_in_future

    // ═══════════════════════════════════════════════════════════════════════════════
    //                        BALANCE & MAX END CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════════
    // streams_state, balance_at, calc_balance, calc_max_end, is_balance_enough

    // ═══════════════════════════════════════════════════════════════════════════════
    //                            RECEIVING STREAMS
    // ═══════════════════════════════════════════════════════════════════════════════
    // receive_streams, receive_streams_result, receivable_streams_cycles, receivable_streams_cycles_range

    // ═══════════════════════════════════════════════════════════════════════════════
    //                          SQUEEZING & SET STREAMS
    // ═══════════════════════════════════════════════════════════════════════════════
    // squeeze_streams, squeeze_streams_result, squeezed_amt, set_streams
}

