module xylkit::drips {
    use aptos_std::smart_table::{Self, SmartTable};
    use aptos_std::type_info::TypeInfo;
    use aptos_framework::account::{Self, SignerCapability};
    use aptos_framework::event;
    use aptos_framework::object;
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::primary_fungible_store;
    use xylkit::streams;
    use xylkit::splits;

    friend xylkit::address_driver;
    friend xylkit::nft_driver;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                 CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Maximum number of streams receivers of a single account.
    const MAX_STREAMS_RECEIVERS: u64 = 100;

    /// The additional decimals for all amtPerSec values (9 decimals).
    const AMT_PER_SEC_EXTRA_DECIMALS: u8 = 9;

    /// The multiplier for all amtPerSec values (10^9).
    const AMT_PER_SEC_MULTIPLIER: u256 = 1_000_000_000;

    /// Maximum number of splits receivers of a single account.
    const MAX_SPLITS_RECEIVERS: u64 = 200;

    /// The total splits weight of an account (1_000_000 = 100%).
    const TOTAL_SPLITS_WEIGHT: u32 = 1_000_000;

    /// The offset of the controlling driver ID in the account ID.
    /// Account ID = driverId (32 bits) | driverCustomData (224 bits).
    const DRIVER_ID_OFFSET: u8 = 224;

    /// The total amount the protocol can store of each token (u128 max).
    const MAX_TOTAL_BALANCE: u128 = 340282366920938463463374607431768211455;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                   ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    const E_TOTAL_BALANCE_TOO_HIGH: u64 = 1;
    const E_TOKEN_BALANCE_TOO_LOW: u64 = 2;
    const E_WITHDRAWAL_AMOUNT_TOO_HIGH: u64 = 3;

    /// Seed for creating the resource account that holds tokens
    const RESOURCE_ACCOUNT_SEED: vector<u8> = b"drips_vault";

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              STORAGE & TYPES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Global storage - lives at @xylkit
    struct DripsStorage has key {
        /// The balance of each token currently stored in the protocol.
        balances: SmartTable<TypeInfo, Balance>,
        /// Signer capability for the resource account that holds tokens
        signer_cap: SignerCapability,
        /// Address of the resource account (cached for convenience)
        vault_address: address
    }

    /// The balance currently stored in the protocol per token.
    struct Balance has store {
        /// The balance currently stored in streaming.
        streams: u128,
        /// The balance currently stored in splitting.
        splits: u128
    }

    /// Account metadata key-value pair.
    struct AccountMetadata has copy, drop, store {
        /// The metadata key
        key: vector<u8>,
        /// The metadata value
        value: vector<u8>
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                  EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[event]
    /// Emitted by the account to broadcast metadata.
    struct AccountMetadataEmitted has drop, store {
        account_id: u256,
        key: vector<u8>,
        value: vector<u8>
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Default cycle length: 5 Minutes (300 seconds)
    /// Change this value before deployment if you want a different cycle length.
    const DEFAULT_CYCLE_SECS: u64 = 300;

    /// Initialize drips, streams, and splits storage.
    /// Called automatically when the module is published.
    fun init_module(deployer: &signer) {
        streams::initialize(deployer, DEFAULT_CYCLE_SECS);
        splits::initialize(deployer);

        // Create resource account to hold tokens
        let (_, signer_cap) =
            account::create_resource_account(deployer, RESOURCE_ACCOUNT_SEED);
        let vault_address = account::get_signer_capability_address(&signer_cap);

        move_to(
            deployer,
            DripsStorage { balances: smart_table::new(), signer_cap, vault_address }
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Ensures a Balance entry exists for the given token type
    fun ensure_balance_exists(
        balances_table: &mut SmartTable<TypeInfo, Balance>, token_type: TypeInfo
    ) {
        if (!balances_table.contains(token_type)) {
            balances_table.add(token_type, Balance { streams: 0, splits: 0 });
        };
    }

    /// Returns the token balance held by the Drips vault (resource account).
    /// Assumes token_type points to a Fungible Asset metadata.
    fun token_balance(token_type: TypeInfo): u128 acquires DripsStorage {
        let storage = borrow_global<DripsStorage>(@xylkit);
        let vault_address = storage.vault_address;
        let token_address = token_type.account_address();

        let metadata = object::address_to_object<Metadata>(token_address);
        (primary_fungible_store::balance(vault_address, metadata) as u128)
    }

    /// Returns the vault address where tokens are held
    public fun vault_address(): address acquires DripsStorage {
        borrow_global<DripsStorage>(@xylkit).vault_address
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           BALANCE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns the amount currently stored in the protocol of the given token.
    /// The sum of streaming and splitting balances can never exceed `MAX_TOTAL_BALANCE`.
    ///
    /// `token_type`: The TypeInfo of the token
    ///
    /// Returns: (streams_balance, splits_balance)
    public fun balances(token_type: TypeInfo): (u128, u128) acquires DripsStorage {
        let storage = borrow_global<DripsStorage>(@xylkit);

        if (!storage.balances.contains(token_type)) {
            return (0, 0)
        };

        let balance = storage.balances.borrow(token_type);
        (balance.streams, balance.splits)
    }

    /// Increases the balance of the given token currently stored in streams.\
    /// No funds are transferred, all the tokens are expected to be already held by Drips.\
    /// The new total balance is verified to have coverage in the held tokens\
    /// and to be within the limit of `MAX_TOTAL_BALANCE`.
    ///
    /// `token_type`: The TypeInfo of the token\
    /// `amt`: The amount to increase the streams balance by
    fun increase_streams_balance(token_type: TypeInfo, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };

        verify_balance_increase(token_type, amt);

        let storage = borrow_global_mut<DripsStorage>(@xylkit);
        ensure_balance_exists(&mut storage.balances, token_type);

        let balance = storage.balances.borrow_mut(token_type);
        balance.streams += amt;
    }

    /// Decreases the balance of the given token currently stored in streams.
    /// No funds are transferred, but the tokens held by Drips
    /// above the total balance become withdrawable.
    ///
    /// `token_type`: The TypeInfo of the token
    /// `amt`: The amount to decrease the streams balance by
    fun decrease_streams_balance(token_type: TypeInfo, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };

        let storage = borrow_global_mut<DripsStorage>(@xylkit);
        let balance = storage.balances.borrow_mut(token_type);
        balance.streams -= amt;
    }

    /// Increases the balance of the given token currently stored in splits.
    /// No funds are transferred, all the tokens are expected to be already held by Drips.
    /// The new total balance is verified to have coverage in the held tokens
    /// and to be within the limit of `MAX_TOTAL_BALANCE`.
    ///
    /// `token_type`: The TypeInfo of the token
    /// `amt`: The amount to increase the splits balance by
    fun increase_splits_balance(token_type: TypeInfo, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };

        verify_balance_increase(token_type, amt);

        let storage = borrow_global_mut<DripsStorage>(@xylkit);
        ensure_balance_exists(&mut storage.balances, token_type);

        let balance = storage.balances.borrow_mut(token_type);
        balance.splits += amt;
    }

    /// Decreases the balance of the given token currently stored in splits.
    /// No funds are transferred, but the tokens held by Drips
    /// above the total balance become withdrawable.
    ///
    /// `token_type`: The TypeInfo of the token
    /// `amt`: The amount to decrease the splits balance by
    fun decrease_splits_balance(token_type: TypeInfo, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };

        let storage = borrow_global_mut<DripsStorage>(@xylkit);
        let balance = storage.balances.borrow_mut(token_type);
        balance.splits -= amt;
    }

    /// Moves the balance of the given token from streams to splits.
    /// No funds are transferred, all the tokens are already held by Drips.
    /// Used when streams are received and become splittable.
    ///
    /// `token_type`: The TypeInfo of the token
    /// `amt`: The amount to move from streams to splits
    fun move_balance_from_streams_to_splits(
        token_type: TypeInfo, amt: u128
    ) acquires DripsStorage {
        if (amt == 0) { return };

        let storage = borrow_global_mut<DripsStorage>(@xylkit);
        let balance = storage.balances.borrow_mut(token_type);
        balance.streams -= amt;
        balance.splits += amt;
    }

    /// Verifies that the balance of streams or splits can be increased by the given amount.
    /// The sum of streaming and splitting balances is checked to not exceed
    /// `MAX_TOTAL_BALANCE` or the amount of tokens held by Drips.
    ///
    /// `token_type`: The TypeInfo of the token
    /// `amt`: The amount to increase the streams or splits balance by
    public fun verify_balance_increase(token_type: TypeInfo, amt: u128) acquires DripsStorage {
        let (streams_balance, splits_balance) = balances(token_type);
        let new_total_balance =
            (streams_balance as u256) + (splits_balance as u256) + (amt as u256);

        // Check against MAX_TOTAL_BALANCE
        assert!(
            new_total_balance <= (MAX_TOTAL_BALANCE as u256), E_TOTAL_BALANCE_TOO_HIGH
        );

        // Check against actual token balance held by the contract
        let held_balance = token_balance(token_type);
        assert!(new_total_balance <= (held_balance as u256), E_TOKEN_BALANCE_TOO_LOW);
    }

    /// Transfers withdrawable funds to an address.
    /// The withdrawable funds are held by the Drips contract,
    /// but not used in the protocol, so they are free to be transferred out.
    /// Anybody can call `withdraw`, so all withdrawable funds should be withdrawn
    /// or used in the protocol before any 3rd parties have a chance to do that.
    ///
    /// `token_type`: The TypeInfo of the token (either Coin type or FA Metadata address)
    /// `receiver`: The address to send withdrawn funds to
    /// `amt`: The withdrawn amount. Must be at most the difference between
    ///        the balance held by Drips and the sum of balances managed by the protocol.
    public fun withdraw(
        token_type: TypeInfo, receiver: address, amt: u128
    ) acquires DripsStorage {
        let (streams_balance, splits_balance) = balances(token_type);
        let held_balance = token_balance(token_type);

        let managed_balance = streams_balance + splits_balance;
        let withdrawable = held_balance - managed_balance;

        assert!(amt <= withdrawable, E_WITHDRAWAL_AMOUNT_TOO_HIGH);

        // Get the vault signer to transfer tokens
        let storage = borrow_global<DripsStorage>(@xylkit);
        let vault_signer = account::create_signer_with_capability(&storage.signer_cap);

        // Transfer FA tokens from vault to receiver
        let token_address = token_type.account_address();
        let metadata = object::address_to_object<Metadata>(token_address);
        primary_fungible_store::transfer(&vault_signer, metadata, receiver, (amt as u64));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           STREAMS OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Counts cycles from which streams can be collected.
    /// Useful to detect if there are too many cycles to analyze in a single transaction.
    public fun receivable_streams_cycles(
        account_id: u256, token_type: TypeInfo
    ): u64 {
        streams::receivable_streams_cycles(account_id, token_type)
    }

    /// Calculate effects of calling `receive_streams` with the given parameters.
    /// Returns: (receivable_amt, receivable_cycles, from_cycle, to_cycle, amt_per_cycle)
    public fun receive_streams_result(
        account_id: u256, token_type: TypeInfo, max_cycles: u64
    ): (u128, u64, u64, u64, i128) {
        streams::receive_streams_result(token_type, account_id, max_cycles)
    }

    /// Receive streams for the account.
    /// Received streams cycles won't need to be analyzed ever again.
    /// Calling this function does not collect but makes the funds ready to be split and collected.
    public fun receive_streams(
        account_id: u256, token_type: TypeInfo, max_cycles: u64
    ): u128 acquires DripsStorage {
        let received_amt = streams::receive_streams(token_type, account_id, max_cycles);
        if (received_amt != 0) {
            move_balance_from_streams_to_splits(token_type, received_amt);
            splits::add_splittable(account_id, token_type, received_amt);
        };
        received_amt
    }

    /// Calculate effects of calling `squeeze_streams` with the given parameters.
    /// Returns: (amt, squeezed_indexes, history_hashes, curr_cycle_configs)
    public fun squeeze_streams_result(
        account_id: u256,
        token_type: TypeInfo,
        sender_id: u256,
        history_hash: vector<u8>,
        streams_history: &vector<streams::StreamsHistory>
    ): (u128, vector<u64>, vector<vector<u8>>, u64) {
        streams::squeeze_streams_result(
            account_id,
            token_type,
            sender_id,
            history_hash,
            streams_history
        )
    }

    /// Receive streams from the currently running cycle from a single sender.
    /// It doesn't receive streams from finished cycles - use `receive_streams` for that.
    /// Squeezed funds won't be received in subsequent calls to `squeeze_streams` or `receive_streams`.
    /// Only funds streamed before current timestamp can be squeezed.
    public fun squeeze_streams(
        account_id: u256,
        token_type: TypeInfo,
        sender_id: u256,
        history_hash: vector<u8>,
        streams_history: &vector<streams::StreamsHistory>
    ): u128 acquires DripsStorage {
        let amt =
            streams::squeeze_streams(
                account_id,
                token_type,
                sender_id,
                history_hash,
                streams_history
            );
        if (amt != 0) {
            move_balance_from_streams_to_splits(token_type, amt);
            splits::add_splittable(account_id, token_type, amt);
        };
        amt
    }

    /// Current account streams state.
    /// Returns: (streams_hash, streams_history_hash, update_time, balance, max_end)
    public fun streams_state(
        account_id: u256, token_type: TypeInfo
    ): (vector<u8>, vector<u8>, u64, u128, u64) {
        streams::streams_state(account_id, token_type)
    }

    /// The account's streams balance at the given timestamp.
    public fun balance_at(
        account_id: u256,
        token_type: TypeInfo,
        curr_receivers: &vector<streams::StreamReceiver>,
        timestamp: u64
    ): u128 {
        streams::balance_at(
            token_type,
            account_id,
            curr_receivers,
            timestamp
        )
    }

    /// Sets the account's streams configuration.
    /// Requires that the tokens used to increase the streams balance
    /// are already sent to Drips and are withdrawable.
    /// If the streams balance is decreased, the released tokens become withdrawable.
    public(friend) fun set_streams(
        account_id: u256,
        token_type: TypeInfo,
        curr_receivers: &vector<streams::StreamReceiver>,
        balance_delta: i128,
        new_receivers: &vector<streams::StreamReceiver>,
        max_end_hint1: u64,
        max_end_hint2: u64
    ): i128 acquires DripsStorage {
        if (balance_delta > 0) {
            increase_streams_balance(token_type, (balance_delta as u128));
        };

        let real_balance_delta =
            streams::set_streams(
                account_id,
                token_type,
                curr_receivers,
                balance_delta,
                new_receivers,
                max_end_hint1,
                max_end_hint2
            );

        if (real_balance_delta < 0) {
            decrease_streams_balance(token_type, ((0 - real_balance_delta) as u128));
        };

        real_balance_delta
    }

    /// Calculates the hash of the streams configuration.
    public fun hash_streams(receivers: &vector<streams::StreamReceiver>): vector<u8> {
        streams::hash_streams(receivers)
    }

    /// Calculates the hash of the streams history after configuration update.
    public fun hash_streams_history(
        old_streams_history_hash: &vector<u8>,
        streams_hash: &vector<u8>,
        update_time: u64,
        max_end: u64
    ): vector<u8> {
        streams::hash_streams_history(
            old_streams_history_hash,
            streams_hash,
            update_time,
            max_end
        )
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           SPLITS OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns account's received but not split yet funds.
    public fun splittable(account_id: u256, token_type: TypeInfo): u128 {
        splits::splittable(account_id, token_type)
    }

    /// Calculate the result of splitting an amount using the current splits configuration.
    /// Returns: (collectable_amt, split_amt)
    public fun split_result(
        account_id: u256, curr_receivers: &vector<splits::SplitsReceiver>, amount: u128
    ): (u128, u128) {
        splits::split_result(account_id, curr_receivers, amount)
    }

    /// Splits the account's splittable funds among receivers.
    /// The entire splittable balance of the given token is split.
    /// All split funds are split using the current splits configuration.
    /// Returns: (collectable_amt, split_amt)
    public fun split(
        account_id: u256,
        token_type: TypeInfo,
        curr_receivers: &vector<splits::SplitsReceiver>
    ): (u128, u128) {
        splits::split(account_id, token_type, curr_receivers)
    }

    /// Returns account's received funds already split and ready to be collected.
    public fun collectable(account_id: u256, token_type: TypeInfo): u128 {
        splits::collectable(account_id, token_type)
    }

    /// Collects account's received already split funds and makes them withdrawable.
    /// Anybody can call `withdraw`, so all withdrawable funds should be withdrawn
    /// or used in the protocol before any 3rd parties have a chance to do that.
    public(friend) fun collect(account_id: u256, token_type: TypeInfo): u128 acquires DripsStorage {
        let amt = splits::collect(account_id, token_type);
        if (amt != 0) {
            decrease_splits_balance(token_type, amt);
        };
        amt
    }

    /// Gives funds from the account to the receiver.
    /// The receiver can split and collect them immediately.
    /// Requires that the tokens used to give are already sent to Drips and are withdrawable.
    public(friend) fun give(
        account_id: u256,
        receiver: u256,
        token_type: TypeInfo,
        amt: u128
    ) acquires DripsStorage {
        if (amt != 0) {
            increase_splits_balance(token_type, amt);
        };
        splits::give(account_id, receiver, token_type, amt);
    }

    /// Sets the account splits configuration.
    /// The configuration is common for all token types.
    /// Nothing happens to the currently splittable funds, but when they are split
    /// after this function finishes, the new splits configuration will be used.
    public(friend) fun set_splits(
        account_id: u256, receivers: &vector<splits::SplitsReceiver>
    ) {
        splits::set_splits(account_id, receivers)
    }

    /// Current account's splits hash.
    public fun splits_hash(account_id: u256): vector<u8> {
        splits::splits_hash(account_id)
    }

    /// Calculates the hash of the list of splits receivers.
    public fun hash_splits(receivers: &vector<splits::SplitsReceiver>): vector<u8> {
        splits::hash_splits(receivers)
    }

    /// Emits account metadata for off-chain indexing.
    /// The keys and values are not standardized by the protocol — it's up to users
    /// to establish conventions for compatibility with consumers.
    public(friend) fun emit_account_metadata(
        account_id: u256, account_metadata: vector<AccountMetadata>
    ) {
        let len = account_metadata.length();
        let i = 0;
        while (i < len) {
            let metadata = account_metadata.borrow(i);
            event::emit(
                AccountMetadataEmitted {
                    account_id,
                    key: metadata.key,
                    value: metadata.value
                }
            );
            i += 1;
        };
    }
}

