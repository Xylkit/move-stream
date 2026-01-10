module xylkit::splits {
    use std::vector;
    use aptos_std::smart_table::{Self, SmartTable};
    use std::type_info::TypeInfo;

    friend xylkit::drips;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Maximum number of splits receivers of a single account.
    const MAX_SPLITS_RECEIVERS: u64 = 200;

    /// The total splits weight of an account (1_000_000 = 100%).
    const TOTAL_SPLITS_WEIGHT: u32 = 1_000_000;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              ERROR CODES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Too many splits receivers (max 200)
    const E_TOO_MANY_SPLITS_RECEIVERS: u64 = 1;
    /// Splits receiver weight is zero
    const E_SPLITS_RECEIVER_WEIGHT_ZERO: u64 = 2;
    /// Splits receivers not sorted by account_id
    const E_SPLITS_RECEIVERS_NOT_SORTED: u64 = 3;
    /// Sum of splits weights exceeds TOTAL_SPLITS_WEIGHT
    const E_SPLITS_WEIGHTS_SUM_TOO_HIGH: u64 = 4;
    /// Provided receivers don't match stored splits hash
    const E_INVALID_CURRENT_SPLITS_RECEIVERS: u64 = 5;
    /// Storage already initialized
    const E_ALREADY_INITIALIZED: u64 = 6;
    /// Caller is not the deployer
    const E_NOT_DEPLOYER: u64 = 7;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              STORAGE & TYPES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Global storage - lives at @xylkit
    struct SplitsStorage has key {
        /// Account splits states.
        states: SmartTable<u256, SplitsState>
    }

    /// Per-account splits state
    struct SplitsState has store {
        /// The account's splits configuration hash.
        splits_hash: vector<u8>,
        /// The account's splits balances.
        balances: SmartTable<TypeInfo, SplitsBalance>
    }

    /// Balance tracking for an account per token
    struct SplitsBalance has store {
        /// Not yet split balance, must be split before collecting.
        splittable: u128,
        /// Already split balance, ready to be collected.
        collectable: u128
    }

    /// A splits receiver configuration
    struct SplitsReceiver has copy, drop, store {
        /// The receiver's account ID
        account_id: u256,
        /// The splits weight (share = weight / TOTAL_SPLITS_WEIGHT)
        weight: u32
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTORS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Creates a new SplitsReceiver
    public fun new_splits_receiver(account_id: u256, weight: u32): SplitsReceiver {
        SplitsReceiver { account_id, weight }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              INITIALIZATION
    // ═════════════════════════════════════════════════════════════

    /// Initialize splits storage at @xylkit\
    /// Called by drips::init_module
    public(friend) fun initialize(account: &signer) {
        let addr = std::signer::address_of(account);
        assert!(addr == @xylkit, E_NOT_DEPLOYER);
        assert!(!exists<SplitsStorage>(addr), E_ALREADY_INITIALIZED);

        move_to(account, SplitsStorage { states: smart_table::new() });
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Ensures a SplitsState exists for the given account_id, creating if needed
    fun ensure_state_exists(
        states: &mut SmartTable<u256, SplitsState>, account_id: u256
    ) {
        if (!states.contains(account_id)) {
            states.add(
                account_id,
                SplitsState {
                    splits_hash: vector::empty(),
                    balances: smart_table::new()
                }
            );
        };
    }

    /// Ensures a SplitsBalance exists for the given token_type, creating if needed
    fun ensure_balance_exists(
        balances: &mut SmartTable<TypeInfo, SplitsBalance>, token_type: TypeInfo
    ) {
        if (!balances.contains(token_type)) {
            balances.add(token_type, SplitsBalance { splittable: 0, collectable: 0 });
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                            BALANCE OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Adds an amount to the splittable balance of an account.
    /// Called internally when funds are received (e.g., from streams or gives).
    ///
    /// `account_id`: The account ID to add splittable funds to\
    /// `token_type`: The token type\
    /// `amt`: The amount to add
    public(friend) fun add_splittable(
        account_id: u256, token_type: TypeInfo, amt: u128
    ) acquires SplitsStorage {
        if (amt == 0) { return };

        let storage = borrow_global_mut<SplitsStorage>(@xylkit);
        ensure_state_exists(&mut storage.states, account_id);

        let state = storage.states.borrow_mut(account_id);
        ensure_balance_exists(&mut state.balances, token_type);

        let balance = state.balances.borrow_mut(token_type);
        balance.splittable += amt;
    }

    /// Returns account's received but not split yet funds.
    ///
    /// `account_id`: The account ID\
    /// `token_type`: The token type
    ///
    /// Returns: The amount received but not split yet
    public fun splittable(account_id: u256, token_type: TypeInfo): u128 acquires SplitsStorage {
        let storage = borrow_global<SplitsStorage>(@xylkit);

        if (!storage.states.contains(account_id)) {
            return 0
        };

        let state = storage.states.borrow(account_id);

        if (!state.balances.contains(token_type)) {
            return 0
        };

        state.balances.borrow(token_type).splittable
    }

    /// Returns account's received funds already split and ready to be collected.
    ///
    /// `account_id`: The account ID\
    /// `token_type`: The token type
    ///
    /// Returns: The collectable amount
    public fun collectable(account_id: u256, token_type: TypeInfo): u128 acquires SplitsStorage {
        let storage = borrow_global<SplitsStorage>(@xylkit);

        if (!storage.states.contains(account_id)) {
            return 0
        };

        let state = storage.states.borrow(account_id);

        if (!state.balances.contains(token_type)) {
            return 0
        };

        state.balances.borrow(token_type).collectable
    }

    /// Collects account's received already split funds.
    /// Resets the collectable balance to 0 and returns the collected amount.
    ///
    /// `account_id`: The account ID\
    /// `token_type`: The token type
    ///
    /// Returns: The collected amount
    public(friend) fun collect(account_id: u256, token_type: TypeInfo): u128 acquires SplitsStorage {
        let storage = borrow_global_mut<SplitsStorage>(@xylkit);

        if (!storage.states.contains(account_id)) {
            return 0
        };

        let state = storage.states.borrow_mut(account_id);

        if (!state.balances.contains(token_type)) {
            return 0
        };

        let balance = state.balances.borrow_mut(token_type);
        let amt = balance.collectable;
        balance.collectable = 0;

        amt
    }

    /// Gives funds from the account to the receiver.
    /// The receiver can split and collect them immediately.
    /// Adds the amount directly to the receiver's splittable balance.
    ///
    /// `account_id`: The giving account ID (for event tracking)
    /// `receiver`: The receiver account ID\
    /// `token_type`: The token type\
    /// `amt`: The amount to give
    public(friend) fun give(
        _account_id: u256,
        receiver: u256,
        token_type: TypeInfo,
        amt: u128
    ) acquires SplitsStorage {
        add_splittable(receiver, token_type, amt);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                            SPLIT OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Calculate the result of splitting an amount using the current splits configuration.
    /// Does not modify state - use for previewing split results.
    ///
    /// `account_id`: The account ID\
    /// `curr_receivers`: The list of the account's current splits receivers\
    /// `amount`: The amount being split
    ///
    /// Returns: (collectable_amt, split_amt)
    ///   - collectable_amt: Amount made collectable for the account
    ///   - split_amt: Amount split to receivers
    public fun split_result(
        account_id: u256, curr_receivers: &vector<SplitsReceiver>, amount: u128
    ): (u128, u128) acquires SplitsStorage {
        assert_curr_splits(account_id, curr_receivers);

        if (amount == 0) {
            return (0, 0)
        };

        // Calculate total weight of all receivers
        let splits_weight: u64 = 0;
        let len = curr_receivers.length();
        let i = 0;
        while (i < len) {
            splits_weight +=(curr_receivers.borrow(i).weight as u64);
            i += 1;
        };

        let split_amt =
            (((amount as u256) * (splits_weight as u256) / (TOTAL_SPLITS_WEIGHT as u256)) as u128);
        let collectable_amt = amount - split_amt;

        (collectable_amt, split_amt)
    }

    /// Splits the account's splittable funds among receivers.
    /// The entire splittable balance of the given token is split.
    /// All split funds are split using the current splits configuration.
    ///
    /// `account_id`: The account ID\
    /// `token_type`: The token type\
    /// `curr_receivers`: The list of the account's current splits receivers
    ///
    /// Returns: (collectable_amt, split_amt)
    ///   - collectable_amt: Amount made collectable for the account
    ///   - split_amt: Amount split to receivers
    public(friend) fun split(
        account_id: u256, token_type: TypeInfo, curr_receivers: &vector<SplitsReceiver>
    ): (u128, u128) acquires SplitsStorage {
        assert_curr_splits(account_id, curr_receivers);

        let storage = borrow_global_mut<SplitsStorage>(@xylkit);
        ensure_state_exists(&mut storage.states, account_id);

        let state = storage.states.borrow_mut(account_id);
        ensure_balance_exists(&mut state.balances, token_type);

        let balance = state.balances.borrow_mut(token_type);
        let collectable_amt = balance.splittable;

        if (collectable_amt == 0) {
            return (0, 0)
        };

        // Reset splittable
        balance.splittable = 0;

        // Calculate and distribute splits
        let splits_weight: u64 = 0;
        let split_amt: u128 = 0;
        let len = curr_receivers.length();
        let i = 0;

        while (i < len) {
            let receiver = curr_receivers.borrow(i);
            splits_weight +=(receiver.weight as u64);

            // Calculate this receiver's share using cumulative weight
            let curr_split_amt =
                (
                    ((collectable_amt as u256) * (splits_weight as u256)
                        / (TOTAL_SPLITS_WEIGHT as u256)) as u128
                ) - split_amt;
            split_amt += curr_split_amt;

            // Add to receiver's splittable balance
            if (curr_split_amt > 0) {
                ensure_state_exists(&mut storage.states, receiver.account_id);
                let receiver_state = storage.states.borrow_mut(receiver.account_id);
                ensure_balance_exists(&mut receiver_state.balances, token_type);
                let receiver_balance = receiver_state.balances.borrow_mut(token_type);
                receiver_balance.splittable += curr_split_amt;
            };

            i += 1;
        };

        // Remaining amount goes to account's collectable
        collectable_amt -= split_amt;

        // Re-borrow after mutations
        let state = storage.states.borrow_mut(account_id);
        let balance = state.balances.borrow_mut(token_type);
        balance.collectable += collectable_amt;

        (collectable_amt, split_amt)
    }

    /// Sets the account splits configuration.
    /// The configuration is common for all token types.
    /// Nothing happens to the currently splittable funds, but when they are split
    /// after this function finishes, the new splits configuration will be used.
    ///
    /// `account_id`: The account ID\
    /// `receivers`: The list of the account's splits receivers to be set.
    ///   Must be sorted by account_id, deduplicated and without 0 weights.
    ///   Each receiver gets `weight / TOTAL_SPLITS_WEIGHT` share of split funds.
    ///   If sum of weights < TOTAL_SPLITS_WEIGHT, remainder stays with account.
    public(friend) fun set_splits(
        account_id: u256, receivers: &vector<SplitsReceiver>
    ) acquires SplitsStorage {
        let storage = borrow_global_mut<SplitsStorage>(@xylkit);
        ensure_state_exists(&mut storage.states, account_id);

        let state = storage.states.borrow_mut(account_id);
        let new_splits_hash = hash_splits(receivers);

        // Only validate and update if hash changed
        if (new_splits_hash != state.splits_hash) {
            assert_splits_valid(receivers);
            state.splits_hash = new_splits_hash;
        };
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                         VALIDATION & HASHING
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Validates a list of splits receivers.
    /// Checks: count <= MAX, no zero weights, sorted by account_id, total weight <= TOTAL.
    fun assert_splits_valid(receivers: &vector<SplitsReceiver>) {
        let len = receivers.length();
        assert!(len <= MAX_SPLITS_RECEIVERS, E_TOO_MANY_SPLITS_RECEIVERS);

        let total_weight: u64 = 0;
        let prev_account_id: u256 = 0;
        let i = 0;

        while (i < len) {
            let receiver = receivers.borrow(i);

            // Weight must be non-zero
            assert!(receiver.weight != 0, E_SPLITS_RECEIVER_WEIGHT_ZERO);
            total_weight +=(receiver.weight as u64);

            // Must be sorted by account_id (strictly increasing)
            if (i > 0) {
                assert!(
                    prev_account_id < receiver.account_id,
                    E_SPLITS_RECEIVERS_NOT_SORTED
                );
            };
            prev_account_id = receiver.account_id;

            i += 1;
        };

        // Total weight must not exceed maximum
        assert!(
            total_weight <= (TOTAL_SPLITS_WEIGHT as u64), E_SPLITS_WEIGHTS_SUM_TOO_HIGH
        );
    }

    /// Asserts that the list of splits receivers is the account's currently used one.
    fun assert_curr_splits(
        account_id: u256, curr_receivers: &vector<SplitsReceiver>
    ) acquires SplitsStorage {
        assert!(
            hash_splits(curr_receivers) == splits_hash(account_id),
            E_INVALID_CURRENT_SPLITS_RECEIVERS
        );
    }

    /// Returns the current account's splits hash.
    public fun splits_hash(account_id: u256): vector<u8> acquires SplitsStorage {
        let storage = borrow_global<SplitsStorage>(@xylkit);

        if (!storage.states.contains(account_id)) {
            return vector::empty()
        };

        storage.states.borrow(account_id).splits_hash
    }

    /// Calculates the hash of the list of splits receivers.
    /// Returns empty vector if receivers is empty, otherwise blake2b_256 hash.
    public fun hash_splits(receivers: &vector<SplitsReceiver>): vector<u8> {
        if (receivers.length() == 0) {
            return vector::empty()
        };
        aptos_std::aptos_hash::blake2b_256(std::bcs::to_bytes(receivers))
    }
}

