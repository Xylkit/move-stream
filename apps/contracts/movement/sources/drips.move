module xylkstream::drips {
    use aptos_std::smart_table::{Self, SmartTable};
    use aptos_framework::account::{Self, SignerCapability};
    use aptos_framework::event;
    use aptos_framework::object;
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::primary_fungible_store;
    use xylkstream::streams;
    use xylkstream::splits;
    use xylkstream::driver_utils::{Self, AccountMetadata};
    use movemate::i128::{Self, I128};

    friend xylkstream::address_driver;
    friend xylkstream::nft_driver;
    friend xylkstream::driver_transfer_utils;

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

    /// The total amount the protocol can store of each token (u128 max).
    const MAX_TOTAL_BALANCE: u128 = 340282366920938463463374607431768211455;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                   ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Total balance would exceed MAX_TOTAL_BALANCE
    const E_TOTAL_BALANCE_TOO_HIGH: u64 = 1;
    /// Token balance held by Drips is less than the required amount
    const E_TOKEN_BALANCE_TOO_LOW: u64 = 2;
    /// Withdrawal amount exceeds available withdrawable balance
    const E_WITHDRAWAL_AMOUNT_TOO_HIGH: u64 = 3;

    /// Seed for creating the resource account that holds tokens
    const RESOURCE_ACCOUNT_SEED: vector<u8> = b"drips_vault";

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              STORAGE & TYPES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Global storage - lives at @xylkstream
    struct DripsStorage has key {
        /// The balance of each token currently stored in the protocol.
        balances: SmartTable<address, Balance>,
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

    #[event]
    /// Emitted when streams configuration is updated
    struct StreamsSet has drop, store {
        account_id: u256,
        fa_metadata: address,
        receiver_account_ids: vector<u256>,
        receiver_stream_ids: vector<u64>,
        receiver_amt_per_secs: vector<u256>,
        receiver_starts: vector<u64>,
        receiver_durations: vector<u64>,
        balance: u128,
        max_end: u64
    }

    #[event]
    /// Emitted when splits configuration is updated
    struct SplitsSet has drop, store {
        account_id: u256,
        receiver_account_ids: vector<u256>,
        receiver_weights: vector<u32>
    }

    #[event]
    /// Emitted when funds are given directly
    struct Given has drop, store {
        account_id: u256,
        receiver_id: u256,
        fa_metadata: address,
        amount: u128
    }

    #[event]
    /// Emitted when streams are received from completed cycles
    struct Received has drop, store {
        account_id: u256,
        fa_metadata: address,
        amount: u128
    }

    #[event]
    /// Emitted when streams are squeezed from current cycle
    struct Squeezed has drop, store {
        account_id: u256,
        sender_id: u256,
        fa_metadata: address,
        amount: u128
    }

    #[event]
    /// Emitted when splits are executed
    struct SplitExecuted has drop, store {
        account_id: u256,
        fa_metadata: address,
        to_receivers: u128,
        to_self: u128
    }

    #[event]
    /// Emitted when funds are collected
    struct Collected has drop, store {
        account_id: u256,
        fa_metadata: address,
        amount: u128
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Default cycle length: 1 Minute (60 seconds)
    /// Change this value before deployment if you want a different cycle length.
    const DEFAULT_CYCLE_SECS: u64 = 60;

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
    //                           INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Ensures a Balance entry exists for the given token type
    fun ensure_balance_exists(
        balances_table: &mut SmartTable<address, Balance>, fa_metadata: address
    ) {
        if (!balances_table.contains(fa_metadata)) {
            balances_table.add(fa_metadata, Balance { streams: 0, splits: 0 });
        };
    }

    /// Returns the token balance held by the Drips vault (resource account).
    /// Assumes token_type points to a Fungible Asset metadata.
    fun token_balance(fa_metadata: address): u128 acquires DripsStorage {
        let storage = borrow_global<DripsStorage>(@xylkstream);
        let metadata = object::address_to_object<Metadata>(fa_metadata);
        (primary_fungible_store::balance(storage.vault_address, metadata) as u128)
    }

    /// Returns the vault address where tokens are held
    public fun vault_address(): address acquires DripsStorage {
        borrow_global<DripsStorage>(@xylkstream).vault_address
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           BALANCE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns the amount currently stored in the protocol of the given token.
    /// The sum of streaming and splitting balances can never exceed `MAX_TOTAL_BALANCE`.
    ///
    /// `fa_metadata`: The address of FA in use
    ///
    /// Returns: (streams_balance, splits_balance)
    public fun balances(fa_metadata: address): (u128, u128) acquires DripsStorage {
        let storage = borrow_global<DripsStorage>(@xylkstream);
        if (!storage.balances.contains(fa_metadata)) {
            return (0, 0)
        };
        let balance = storage.balances.borrow(fa_metadata);
        (balance.streams, balance.splits)
    }

    /// Increases the balance of the given token currently stored in streams.\
    /// No funds are transferred, all the tokens are expected to be already held by Drips.\
    /// The new total balance is verified to have coverage in the held tokens\
    /// and to be within the limit of `MAX_TOTAL_BALANCE`.
    ///
    /// `fa_metadata`: The address of FA in use\
    /// `amt`: The amount to increase the streams balance by
    fun increase_streams_balance(fa_metadata: address, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };
        verify_balance_increase(fa_metadata, amt);
        let storage = borrow_global_mut<DripsStorage>(@xylkstream);
        ensure_balance_exists(&mut storage.balances, fa_metadata);
        let balance = storage.balances.borrow_mut(fa_metadata);
        balance.streams += amt;
    }

    /// Decreases the balance of the given token currently stored in streams.
    /// No funds are transferred, but the tokens held by Drips
    /// above the total balance become withdrawable.
    ///
    /// `fa_metadata`: The address of FA in use\
    /// `amt`: The amount to decrease the streams balance by
    fun decrease_streams_balance(fa_metadata: address, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };
        let storage = borrow_global_mut<DripsStorage>(@xylkstream);
        let balance = storage.balances.borrow_mut(fa_metadata);
        balance.streams -= amt;
    }

    /// Increases the balance of the given token currently stored in splits.
    /// No funds are transferred, all the tokens are expected to be already held by Drips.
    /// The new total balance is verified to have coverage in the held tokens
    /// and to be within the limit of `MAX_TOTAL_BALANCE`.
    ///
    /// `fa_metadata`: The address of FA in use\
    /// `amt`: The amount to increase the splits balance by
    fun increase_splits_balance(fa_metadata: address, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };
        verify_balance_increase(fa_metadata, amt);
        let storage = borrow_global_mut<DripsStorage>(@xylkstream);
        ensure_balance_exists(&mut storage.balances, fa_metadata);
        let balance = storage.balances.borrow_mut(fa_metadata);
        balance.splits += amt;
    }

    /// Decreases the balance of the given token currently stored in splits.
    /// No funds are transferred, but the tokens held by Drips
    /// above the total balance become withdrawable.
    ///
    /// `fa_metadata`: The address of FA in use\
    /// `amt`: The amount to decrease the splits balance by
    fun decrease_splits_balance(fa_metadata: address, amt: u128) acquires DripsStorage {
        if (amt == 0) { return };
        let storage = borrow_global_mut<DripsStorage>(@xylkstream);
        let balance = storage.balances.borrow_mut(fa_metadata);
        balance.splits -= amt;
    }

    /// Moves the balance of the given token from streams to splits.
    /// No funds are transferred, all the tokens are already held by Drips.
    /// Used when streams are received and become splittable.
    ///
    /// `fa_metadata`: The address of FA in use\
    /// `amt`: The amount to move from streams to splits
    fun move_balance_from_streams_to_splits(
        fa_metadata: address, amt: u128
    ) acquires DripsStorage {
        if (amt == 0) { return };
        let storage = borrow_global_mut<DripsStorage>(@xylkstream);
        let balance = storage.balances.borrow_mut(fa_metadata);
        balance.streams -= amt;
        balance.splits += amt;
    }

    /// Verifies that the balance of streams or splits can be increased by the given amount.
    /// The sum of streaming and splitting balances is checked to not exceed
    /// `MAX_TOTAL_BALANCE` or the amount of tokens held by Drips.
    ///
    /// `fa_metadata`: The address of FA in use\
    /// `amt`: The amount to increase the streams or splits balance by
    public fun verify_balance_increase(fa_metadata: address, amt: u128) acquires DripsStorage {
        let (streams_balance, splits_balance) = balances(fa_metadata);
        let new_total_balance =
            (streams_balance as u256) + (splits_balance as u256) + (amt as u256);

        // Check against MAX_TOTAL_BALANCE
        assert!(
            new_total_balance <= (MAX_TOTAL_BALANCE as u256), E_TOTAL_BALANCE_TOO_HIGH
        );

        // Check against actual token balance held by the contract
        let held_balance = token_balance(fa_metadata);
        assert!(new_total_balance <= (held_balance as u256), E_TOKEN_BALANCE_TOO_LOW);
    }

    /// Transfers withdrawable funds to an address.
    /// The withdrawable funds are held by the Drips contract,
    /// but not used in the protocol, so they are free to be transferred out.
    /// Anybody can call `withdraw`, so all withdrawable funds should be withdrawn
    /// or used in the protocol before any 3rd parties have a chance to do that.
    ///
    /// `fa_metadata`: The address of FA in use\
    /// `receiver`: The address to send withdrawn funds to
    /// `amt`: The withdrawn amount. Must be at most the difference between
    ///        the balance held by Drips and the sum of balances managed by the protocol.
    public(friend) fun withdraw(
        fa_metadata: address, receiver: address, amt: u128
    ) acquires DripsStorage {
        let (streams_balance, splits_balance) = balances(fa_metadata);
        let held_balance = token_balance(fa_metadata);
        let managed_balance = streams_balance + splits_balance;
        let withdrawable = held_balance - managed_balance;
        assert!(amt <= withdrawable, E_WITHDRAWAL_AMOUNT_TOO_HIGH);

        // Get the vault signer to transfer tokens
        let storage = borrow_global<DripsStorage>(@xylkstream);
        let vault_signer = account::create_signer_with_capability(&storage.signer_cap);
        let metadata = object::address_to_object<Metadata>(fa_metadata);
        primary_fungible_store::transfer(&vault_signer, metadata, receiver, (amt as u64));
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           STREAMS OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Receives streams for an account from completed cycles.
    /// Anyone can call this for any account - caller pays gas, account benefits.
    public entry fun receive_streams(
        account_id: u256, fa_metadata: address, max_cycles: u64
    ) acquires DripsStorage {
        let received_amt = streams::receive_streams(fa_metadata, account_id, max_cycles);
        if (received_amt != 0) {
            move_balance_from_streams_to_splits(fa_metadata, received_amt);
            splits::add_splittable(account_id, fa_metadata, received_amt);
            event::emit(Received { account_id, fa_metadata, amount: received_amt });
        };
    }

    #[view]
    public fun squeeze_streams_result(
        account_id: u256,
        fa_metadata: address,
        sender_id: u256,
        history_hash: vector<u8>,
        history_streams_hashes: vector<vector<u8>>,
        history_receiver_account_ids: vector<vector<u256>>,
        history_receiver_stream_ids: vector<vector<u64>>,
        history_receiver_amt_per_secs: vector<vector<u256>>,
        history_receiver_starts: vector<vector<u64>>,
        history_receiver_durations: vector<vector<u64>>,
        history_update_times: vector<u64>,
        history_max_ends: vector<u64>
    ): (u128, vector<u64>, vector<vector<u8>>, u64) {
        let streams_history =
            driver_utils::build_streams_history(
                &history_streams_hashes,
                &history_receiver_account_ids,
                &history_receiver_stream_ids,
                &history_receiver_amt_per_secs,
                &history_receiver_starts,
                &history_receiver_durations,
                &history_update_times,
                &history_max_ends
            );
        streams::squeeze_streams_result(
            account_id,
            fa_metadata,
            sender_id,
            history_hash,
            &streams_history
        )
    }

    /// Squeezes streams from a sender during the current (incomplete) cycle.
    /// Anyone can call this for any account - caller pays gas, account benefits.
    public entry fun squeeze_streams(
        account_id: u256,
        fa_metadata: address,
        sender_id: u256,
        history_hash: vector<u8>,
        history_streams_hashes: vector<vector<u8>>,
        history_receiver_account_ids: vector<vector<u256>>,
        history_receiver_stream_ids: vector<vector<u64>>,
        history_receiver_amt_per_secs: vector<vector<u256>>,
        history_receiver_starts: vector<vector<u64>>,
        history_receiver_durations: vector<vector<u64>>,
        history_update_times: vector<u64>,
        history_max_ends: vector<u64>
    ) acquires DripsStorage {
        let streams_history =
            driver_utils::build_streams_history(
                &history_streams_hashes,
                &history_receiver_account_ids,
                &history_receiver_stream_ids,
                &history_receiver_amt_per_secs,
                &history_receiver_starts,
                &history_receiver_durations,
                &history_update_times,
                &history_max_ends
            );
        let amt =
            streams::squeeze_streams(
                account_id,
                fa_metadata,
                sender_id,
                history_hash,
                &streams_history
            );
        if (amt != 0) {
            move_balance_from_streams_to_splits(fa_metadata, amt);
            splits::add_splittable(account_id, fa_metadata, amt);
            event::emit(
                Squeezed { account_id, sender_id, fa_metadata, amount: amt }
            );
        };
    }

    /// Sets the account's streams configuration.
    /// Requires that the tokens used to increase the streams balance
    /// are already sent to Drips and are withdrawable.
    /// If the streams balance is decreased, the released tokens become withdrawable.
    public(friend) fun set_streams(
        account_id: u256,
        fa_metadata: address,
        curr_receivers: &vector<streams::StreamReceiver>,
        balance_delta: I128,
        new_receivers: &vector<streams::StreamReceiver>,
        max_end_hint1: u64,
        max_end_hint2: u64
    ): I128 acquires DripsStorage {
        if (!i128::is_neg(&balance_delta)) {
            increase_streams_balance(fa_metadata, i128::as_u128(&balance_delta));
        };

        let real_balance_delta =
            streams::set_streams(
                account_id,
                fa_metadata,
                curr_receivers,
                balance_delta,
                new_receivers,
                max_end_hint1,
                max_end_hint2
            );

        if (i128::is_neg(&real_balance_delta)) {
            let abs_delta = i128::abs(&real_balance_delta);
            decrease_streams_balance(fa_metadata, i128::as_u128(&abs_delta));
        };

        real_balance_delta
    }

    /// Emits a StreamsSet event. Called by drivers after set_streams.
    public(friend) fun emit_streams_set(
        account_id: u256,
        fa_metadata: address,
        receiver_account_ids: vector<u256>,
        receiver_stream_ids: vector<u64>,
        receiver_amt_per_secs: vector<u256>,
        receiver_starts: vector<u64>,
        receiver_durations: vector<u64>,
        balance: u128,
        max_end: u64
    ) {
        event::emit(
            StreamsSet {
                account_id,
                fa_metadata,
                receiver_account_ids,
                receiver_stream_ids,
                receiver_amt_per_secs,
                receiver_starts,
                receiver_durations,
                balance,
                max_end
            }
        );
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

    /// Splits an account's splittable balance according to their splits configuration.
    /// Anyone can call this for any account - caller pays gas, account benefits.
    public entry fun split(
        account_id: u256,
        fa_metadata: address,
        receiver_account_ids: vector<u256>,
        receiver_weights: vector<u32>
    ) {
        let receivers =
            driver_utils::build_splits_receivers(
                &receiver_account_ids, &receiver_weights
            );
        let (to_self, to_receivers) = splits::split(account_id, fa_metadata, &receivers);
        if (to_self != 0 || to_receivers != 0) {
            event::emit(
                SplitExecuted { account_id, fa_metadata, to_receivers, to_self }
            );
        };
    }

    /// Collects account's received already split funds and makes them withdrawable.
    /// Anybody can call `withdraw`, so all withdrawable funds should be withdrawn
    /// or used in the protocol before any 3rd parties have a chance to do that.
    public(friend) fun collect(account_id: u256, fa_metadata: address): u128 acquires DripsStorage {
        let amt = splits::collect(account_id, fa_metadata);
        if (amt != 0) {
            decrease_splits_balance(fa_metadata, amt);
            event::emit(Collected { account_id, fa_metadata, amount: amt });
        };
        amt
    }

    /// Gives funds from the account to the receiver.
    /// The receiver can split and collect them immediately.
    /// Requires that the tokens used to give are already sent to Drips and are withdrawable.
    public(friend) fun give(
        account_id: u256,
        receiver: u256,
        fa_metadata: address,
        amt: u128
    ) acquires DripsStorage {
        if (amt != 0) {
            increase_splits_balance(fa_metadata, amt);
            event::emit(
                Given { account_id, receiver_id: receiver, fa_metadata, amount: amt }
            );
        };
        splits::give(account_id, receiver, fa_metadata, amt);
    }

    public(friend) fun set_splits(
        account_id: u256, receivers: &vector<splits::SplitsReceiver>
    ) {
        splits::set_splits(account_id, receivers);
    }

    /// Emits a SplitsSet event. Called by drivers after set_splits.
    public(friend) fun emit_splits_set(
        account_id: u256, receiver_account_ids: vector<u256>, receiver_weights: vector<u32>
    ) {
        event::emit(SplitsSet { account_id, receiver_account_ids, receiver_weights });
    }

    public fun hash_splits(receivers: &vector<splits::SplitsReceiver>): vector<u8> {
        splits::hash_splits(receivers)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[view]
    public fun receivable_streams_cycles(
        account_id: u256, fa_metadata: address
    ): u64 {
        streams::receivable_streams_cycles(account_id, fa_metadata)
    }

    #[view]
    public fun receive_streams_result(
        account_id: u256, fa_metadata: address, max_cycles: u64
    ): (u128, u64, u64, u64, I128) {
        streams::receive_streams_result(fa_metadata, account_id, max_cycles)
    }

    #[view]
    public fun streams_state(
        account_id: u256, fa_metadata: address
    ): (vector<u8>, vector<u8>, u64, u128, u64) {
        streams::streams_state(account_id, fa_metadata)
    }

    #[view]
    public fun balance_at(
        account_id: u256,
        fa_metadata: address,
        receiver_account_ids: vector<u256>,
        receiver_stream_ids: vector<u64>,
        receiver_amt_per_secs: vector<u256>,
        receiver_starts: vector<u64>,
        receiver_durations: vector<u64>,
        timestamp: u64
    ): u128 {
        let receivers =
            driver_utils::build_stream_receivers(
                &receiver_account_ids,
                &receiver_stream_ids,
                &receiver_amt_per_secs,
                &receiver_starts,
                &receiver_durations
            );
        streams::balance_at(fa_metadata, account_id, &receivers, timestamp)
    }

    #[view]
    public fun splittable(account_id: u256, fa_metadata: address): u128 {
        splits::splittable(account_id, fa_metadata)
    }

    #[view]
    public fun split_result(
        account_id: u256,
        receiver_account_ids: vector<u256>,
        receiver_weights: vector<u32>,
        amount: u128
    ): (u128, u128) {
        let receivers =
            driver_utils::build_splits_receivers(
                &receiver_account_ids, &receiver_weights
            );
        splits::split_result(account_id, &receivers, amount)
    }

    #[view]
    public fun collectable(account_id: u256, fa_metadata: address): u128 {
        splits::collectable(account_id, fa_metadata)
    }

    #[view]
    public fun splits_hash(account_id: u256): vector<u8> {
        splits::splits_hash(account_id)
    }

    #[view]
    public fun hash_splits_view(
        receiver_account_ids: vector<u256>, receiver_weights: vector<u32>
    ): vector<u8> {
        let receivers =
            driver_utils::build_splits_receivers(
                &receiver_account_ids, &receiver_weights
            );
        splits::hash_splits(&receivers)
    }

    #[view]
    public fun hash_streams_view(
        receiver_account_ids: vector<u256>,
        receiver_stream_ids: vector<u64>,
        receiver_amt_per_secs: vector<u256>,
        receiver_starts: vector<u64>,
        receiver_durations: vector<u64>
    ): vector<u8> {
        let receivers =
            driver_utils::build_stream_receivers(
                &receiver_account_ids,
                &receiver_stream_ids,
                &receiver_amt_per_secs,
                &receiver_starts,
                &receiver_durations
            );
        streams::hash_streams(&receivers)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           METADATA
    // ═══════════════════════════════════════════════════════════════════════════════

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
                    key: driver_utils::account_metadata_key(metadata),
                    value: driver_utils::account_metadata_value(metadata)
                }
            );
            i += 1;
        };
    }
}

