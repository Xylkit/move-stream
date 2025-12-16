module xylkit::splits {
    use std::signer;
    use std::vector;
    use aptos_framework::coin::{Self, Coin};
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_framework::table::{Self, Table};
    use aptos_std::type_info;
    use aptos_std::aptos_hash;
    use aptos_std::bcs;
    use xylkit::error_handling;

    /// Error codes - using standardized error codes from error_handling module
    const CATEGORY: u8 = 2; // CATEGORY_SPLITS

    // Redefining local error codes for backward compatibility
    const E_INVALID_WEIGHT: u64 = 201;
    const E_TOO_MANY_RECEIVERS: u64 = 202;
    const E_RECEIVERS_NOT_SORTED: u64 = 203;
    const E_WEIGHT_SUM_TOO_HIGH: u64 = 204;
    const E_UNAUTHORIZED: u64 = 1;
    const E_INSUFFICIENT_BALANCE: u64 = 208;
    const E_SPLITS_STORE_NOT_FOUND: u64 = 205;
    const E_DUPLICATE_RECEIVER: u64 = 206;
    const E_SELF_RECEIVER_NOT_ALLOWED: u64 = 207;
    const E_INVALID_CURRENT_RECEIVERS: u64 = 210;

    /// Constants
    const MAX_SPLITS_RECEIVERS: u64 = 200; // Maximum number of splits receivers
    const TOTAL_SPLITS_WEIGHT: u32 = 1000000; // Total weight (100%)
    /// Maximum balance that can be tracked per token
    const MAX_SPLITS_BALANCE: u128 = 340282366920938463463374607431768211455; // type(uint128).max equivalent

    /// SplitsReceiver represents a single receiver in a splits configuration
    /// - receiver: The address that will receive the split funds
    /// - weight: The weight of this receiver (out of TOTAL_SPLITS_WEIGHT)
    struct SplitsReceiver has store, drop, copy {
        receiver: address,
        weight: u32
    }

    /// SplitsBalance tracks splittable and collectable funds for a specific coin type
    /// - splittable: The amount of funds that can be split
    /// - collectable: The amount of funds that can be collected
    struct SplitsBalance has store {
        splittable: u128,
        collectable: u128
    }

    /// SplitsStore is the main resource that stores all splits configurations and balances
    /// - receivers: A vector of all configured split receivers
    /// - receivers_hash: Store hash of current receivers for verification
    /// - balances: A table mapping coin types to their SplitsBalance
    struct SplitsStore has key {
        receivers: vector<SplitsReceiver>,
        receivers_hash: vector<u8>, // Store hash of current receivers
        balances: Table<address, SplitsBalance> // Maps coin type address to SplitsBalance
    }

    /// Events
    /// Emitted when splits are configured
    #[event]
    struct SplitsConfiguredEvent has drop, store {
        sender: address,
        receivers: vector<SplitsReceiver>,
        timestamp: u64
    }

    /// Emitted when funds are split
    #[event]
    struct FundsSplitEvent has drop, store {
        sender: address,
        amount: u128,
        timestamp: u64
    }

    /// Emitted when funds are collected
    #[event]
    struct FundsCollectedEvent has drop, store {
        receiver: address,
        amount: u128,
        timestamp: u64
    }

    /// Emitted when a splits configuration is updated
    #[event]
    struct SplitsUpdatedEvent has drop, store {
        sender: address,
        old_receivers_count: u64,
        new_receivers_count: u64,
        timestamp: u64
    }

    /// Emitted when funds are added to the splittable balance
    #[event]
    struct FundsAddedEvent has drop, store {
        account: address,
        amount: u128,
        timestamp: u64
    }

    /// Emitted when a new SplitsStore is initialized
    #[event]
    struct SplitsInitializedEvent has drop, store {
        account: address,
        timestamp: u64
    }

    /// Emitted when funds are added to a receiver's collectable balance
    #[event]
    struct CollectableAddedEvent has drop, store {
        receiver: address,
        amount: u128,
        coin_type_address: address,
        timestamp: u64
    }

    /// Emitted when a splits receiver is seen during validation
    #[event]
    struct SplitsReceiverSeenEvent has drop, store {
        receivers_hash: vector<u8>,
        account_id: address,
        weight: u32,
        timestamp: u64
    }

    /// Emitted when funds are split to a specific receiver
    #[event]
    struct SplitEvent has drop, store {
        account_id: address,
        receiver: address,
        amount: u128,
        coin_type_address: address,
        timestamp: u64
    }

    /// Emitted when funds are made collectable after splitting
    #[event]
    struct CollectableEvent has drop, store {
        account_id: address,
        amount: u128,
        coin_type_address: address,
        timestamp: u64
    }

    /// Emitted when the account's splits configuration is set (matches Solidity SplitsSet event)
    #[event]
    struct SplitsSetEvent has drop, store {
        account_id: address,
        receivers_hash: vector<u8>,
        timestamp: u64
    }

    /// Initialize a new SplitsStore for the sender
    /// This function creates a new SplitsStore resource and stores it in the sender's account
    /// It can only be called once per account
    public fun initialize(sender: &signer) {
        let sender_addr = signer::address_of(sender);

        // Ensure the SplitsStore doesn't already exist for this account
        error_handling::validate_resource_not_exists<SplitsStore>(
            exists<SplitsStore>(sender_addr),
            CATEGORY,
            E_UNAUTHORIZED
        );

        // Create a new SplitsStore with empty receivers and balances
        let splits_store = SplitsStore {
            receivers: vector::empty<SplitsReceiver>(),
            receivers_hash: vector::empty<u8>(), // Initialize with empty hash
            balances: table::new<address, SplitsBalance>()
        };

        // Move the SplitsStore resource to the sender's account
        move_to(sender, splits_store);

        // Emit initialization event
        event::emit(
            SplitsInitializedEvent {
                account: sender_addr,
                timestamp: timestamp::now_seconds()
            }
        );
    }

    /// Configure splitting receivers
    /// This function updates the splits configuration for the sender
    /// Parameters:
    /// - sender: The signer of the transaction
    /// - receivers: A vector of SplitsReceiver specifying the split receivers
    public fun set_splits(
        sender: &signer, receivers: vector<SplitsReceiver>
    ) acquires SplitsStore {
        let sender_addr = signer::address_of(sender);

        // Ensure the SplitsStore exists for this account
        error_handling::validate_resource_exists<SplitsStore>(
            exists<SplitsStore>(sender_addr),
            CATEGORY,
            E_SPLITS_STORE_NOT_FOUND
        );

        // Validate receivers
        validate_receivers(sender_addr, &receivers);

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(sender_addr);

        // Get the old receivers count for the event
        let old_receivers_count = vector::length(&splits_store.receivers);

        // Update the receivers
        splits_store.receivers = receivers;

        // ADD: Update hash
        splits_store.receivers_hash = hash_receivers(&receivers);

        // Get the new receivers count
        let new_receivers_count = vector::length(&receivers);

        // Emit SplitsSet event (matches Solidity pattern)
        event::emit(
            SplitsSetEvent {
                account_id: sender_addr,
                receivers_hash: splits_store.receivers_hash,
                timestamp: timestamp::now_seconds()
            }
        );

        // Emit splits updated event
        event::emit(
            SplitsUpdatedEvent {
                sender: sender_addr,
                old_receivers_count,
                new_receivers_count,
                timestamp: timestamp::now_seconds()
            }
        );

        // Emit splits configured event
        event::emit(
            SplitsConfiguredEvent {
                sender: sender_addr,
                receivers,
                timestamp: timestamp::now_seconds()
            }
        );
    }

    /// Validate a vector of SplitsReceiver
    /// This function checks that:
    /// - All receivers have a positive weight
    /// - The total weight doesn't exceed TOTAL_SPLITS_WEIGHT
    /// - The number of receivers doesn't exceed MAX_SPLITS_RECEIVERS
    /// - Receivers are sorted by address
    /// - There are no duplicate receivers
    /// - No receiver is the sender
    fun validate_receivers(
        sender_addr: address, receivers: &vector<SplitsReceiver>
    ) {
        let len = vector::length(receivers);

        // Check the number of receivers
        error_handling::assert_with_error(
            len <= MAX_SPLITS_RECEIVERS,
            CATEGORY,
            E_TOO_MANY_RECEIVERS
        );

        // If the vector is empty, there's nothing to validate
        if (len == 0) { return };

        // ADD: Emit receiver seen events
        let receivers_hash = hash_receivers(receivers);
        let i = 0;
        let total_weight: u32 = 0;

        while (i < len) {
            let receiver = vector::borrow(receivers, i);

            // Validate the current receiver
            error_handling::assert_with_error(
                receiver.weight > 0, CATEGORY, E_INVALID_WEIGHT
            );
            error_handling::assert_with_error(
                receiver.receiver != sender_addr, CATEGORY, E_SELF_RECEIVER_NOT_ALLOWED
            );

            // Check sorting for receivers after the first one
            if (i > 0) {
                let prev_receiver = vector::borrow(receivers, i - 1);
                error_handling::assert_with_error(
                    address_less_than(prev_receiver.receiver, receiver.receiver),
                    CATEGORY,
                    E_RECEIVERS_NOT_SORTED
                );
            };

            // ADD: Emit receiver seen event
            event::emit(
                SplitsReceiverSeenEvent {
                    receivers_hash,
                    account_id: receiver.receiver,
                    weight: receiver.weight,
                    timestamp: timestamp::now_seconds()
                }
            );

            // Add to total weight
            total_weight = total_weight + receiver.weight;

            i = i + 1;
        };

        // Check total weight doesn't exceed maximum
        error_handling::assert_with_error(
            total_weight <= TOTAL_SPLITS_WEIGHT,
            CATEGORY,
            E_WEIGHT_SUM_TOO_HIGH
        );
    }

    /// Create a new SplitsReceiver
    /// This is a helper function to create a new SplitsReceiver
    /// Parameters:
    /// - receiver: The address that will receive the split funds
    /// - weight: The weight of this receiver (out of TOTAL_SPLITS_WEIGHT)
    /// Returns: A new SplitsReceiver
    public fun new_receiver(receiver: address, weight: u32): SplitsReceiver {
        SplitsReceiver { receiver, weight }
    }

    /// Compare two addresses for ordering
    /// This function compares two addresses by converting them to bytes and comparing lexicographically
    /// Parameters:
    /// - addr1: The first address
    /// - addr2: The second address
    /// Returns: true if addr1 < addr2, false otherwise
    public fun address_less_than(addr1: address, addr2: address): bool {
        let bytes1 = bcs::to_bytes(&addr1);
        let bytes2 = bcs::to_bytes(&addr2);

        let len1 = vector::length(&bytes1);
        let len2 = vector::length(&bytes2);
        let min_len = if (len1 < len2) { len1 }
        else { len2 };

        let i = 0;
        while (i < min_len) {
            let byte1 = *vector::borrow(&bytes1, i);
            let byte2 = *vector::borrow(&bytes2, i);

            if (byte1 < byte2) {
                return true
            } else if (byte1 > byte2) {
                return false
            };

            i = i + 1;
        };

        // If all compared bytes are equal, the shorter address is "less than"
        len1 < len2
    }

    /// Hash receivers for verification
    /// This function calculates a hash of the receivers list for verification purposes
    /// Parameters:
    /// - receivers: The receivers list to hash
    /// Returns: The hash of the receivers list
    fun hash_receivers(receivers: &vector<SplitsReceiver>): vector<u8> {
        if (vector::length(receivers) == 0) {
            return vector::empty<u8>()
        };
        // Use keccak256 hash of the BCS-encoded receivers
        aptos_hash::keccak256(bcs::to_bytes(receivers))
    }

    /// Verify that current receivers match stored configuration
    /// This function ensures the provided receivers match the stored hash
    /// Parameters:
    /// - account_id: The account to verify receivers for
    /// - curr_receivers: The current receivers to verify
    fun assert_current_receivers(
        account_id: address, curr_receivers: &vector<SplitsReceiver>
    ) acquires SplitsStore {
        let splits_store = borrow_global<SplitsStore>(account_id);
        let provided_hash = hash_receivers(curr_receivers);
        error_handling::assert_with_error(
            provided_hash == splits_store.receivers_hash,
            CATEGORY,
            E_INVALID_CURRENT_RECEIVERS
        );
    }

    /// Split funds according to configured weights
    /// This function calculates how much funds should be split to each receiver
    /// Parameters:
    /// - account_id: The address of the account to split funds for
    /// - curr_receivers: The current splits configuration
    /// Returns: (split_amount, collected_amount)
    public fun split<CoinType>(
        account_id: address, curr_receivers: vector<SplitsReceiver>
    ): (u128, u128) acquires SplitsStore {
        // Ensure the SplitsStore exists for this account
        error_handling::validate_resource_exists<SplitsStore>(
            exists<SplitsStore>(account_id),
            CATEGORY,
            E_SPLITS_STORE_NOT_FOUND
        );

        // ADD: Verify receivers match stored configuration
        assert_current_receivers(account_id, &curr_receivers);

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(account_id);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            // Create a new SplitsBalance
            table::add(
                &mut splits_store.balances,
                coin_type_addr,
                SplitsBalance { splittable: 0, collectable: 0 }
            );
        };

        // Get a mutable reference to the SplitsBalance
        let balance = table::borrow_mut(&mut splits_store.balances, coin_type_addr);

        // Get the splittable amount
        let splittable_amount = balance.splittable;

        // If there's nothing to split, return early
        if (splittable_amount == 0) {
            return (0, 0)
        };

        // Reset the splittable balance
        balance.splittable = 0;

        // Calculate the amount to be collected by the account itself
        let collected_amount =
            calculate_collected_amount(splittable_amount, &curr_receivers);

        // Add the collected amount to the account's collectable balance
        balance.collectable = balance.collectable + collected_amount;

        // Emit collectable event to show how much became collectable for the account
        if (collected_amount > 0) {
            event::emit(
                CollectableEvent {
                    account_id,
                    amount: collected_amount,
                    coin_type_address: coin_type_addr,
                    timestamp: timestamp::now_seconds()
                }
            );
        };

        // Distribute the remaining amount to the receivers
        distribute_to_receivers<CoinType>(
            account_id, splittable_amount - collected_amount, &curr_receivers
        );

        // Emit event
        event::emit(
            FundsSplitEvent {
                sender: account_id,
                amount: splittable_amount,
                timestamp: timestamp::now_seconds()
            }
        );

        (splittable_amount, collected_amount)
    }

    /// Calculate the amount to be collected by the account itself
    /// This function calculates how much of the splittable amount should be collected by the account
    /// Parameters:
    /// - splittable_amount: The total amount to be split
    /// - receivers: The current splits configuration
    /// Returns: The amount to be collected by the account
    fun calculate_collected_amount(
        splittable_amount: u128, receivers: &vector<SplitsReceiver>
    ): u128 {
        // Calculate the total weight of all receivers
        let total_weight: u32 = 0;
        let i = 0;
        let len = vector::length(receivers);

        while (i < len) {
            let receiver = vector::borrow(receivers, i);
            total_weight = total_weight + receiver.weight;
            i = i + 1;
        };

        // Calculate the amount to be collected by the account itself
        // This is the amount that is not distributed to any receiver
        let collected_weight = TOTAL_SPLITS_WEIGHT - total_weight;

        // Calculate the collected amount based on the weight
        (splittable_amount * (collected_weight as u128)) / (TOTAL_SPLITS_WEIGHT as u128)
    }

    /// Distribute funds to receivers
    /// This function distributes funds to all receivers based on their weights
    /// Parameters:
    /// - account_id: The address of the account splitting the funds
    /// - amount: The amount to be distributed
    /// - receivers: The current splits configuration
    fun distribute_to_receivers<CoinType>(
        account_id: address, amount: u128, receivers: &vector<SplitsReceiver>
    ) acquires SplitsStore {
        let i = 0;
        let len = vector::length(receivers);

        while (i < len) {
            let receiver = vector::borrow(receivers, i);

            // Calculate the amount to be distributed to this receiver
            let receiver_amount =
                (amount * (receiver.weight as u128)) / (TOTAL_SPLITS_WEIGHT as u128);

            // If the amount is greater than 0, add it to the receiver's collectable balance
            if (receiver_amount > 0) {
                add_collectable<CoinType>(receiver.receiver, receiver_amount);

                // ADD: Emit split event for each receiver
                event::emit(
                    SplitEvent {
                        account_id,
                        receiver: receiver.receiver,
                        amount: receiver_amount,
                        coin_type_address: get_coin_address<CoinType>(),
                        timestamp: timestamp::now_seconds()
                    }
                );
            };

            i = i + 1;
        };
    }

    /// Add funds to a receiver's collectable balance
    /// This function adds funds to the collectable balance for a specific coin type
    /// Parameters:
    /// - receiver: The address of the receiver to add funds for
    /// - amount: The amount of funds to add
    fun add_collectable<CoinType>(receiver: address, amount: u128) acquires SplitsStore {
        // If the receiver doesn't have a SplitsStore, we can't add funds to their balance
        if (!exists<SplitsStore>(receiver)) { return };

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(receiver);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            // Create a new SplitsBalance
            table::add(
                &mut splits_store.balances,
                coin_type_addr,
                SplitsBalance { splittable: 0, collectable: 0 }
            );
        };

        // Get a mutable reference to the SplitsBalance
        let balance = table::borrow_mut(&mut splits_store.balances, coin_type_addr);

        // Add the amount to the collectable balance
        balance.collectable = balance.collectable + amount;

        // Emit event for funds added to collectable balance
        event::emit(
            CollectableAddedEvent {
                receiver,
                amount,
                coin_type_address: coin_type_addr,
                timestamp: timestamp::now_seconds()
            }
        );
    }

    /// Add funds to be split
    /// This function adds funds to the splittable balance for a specific coin type
    /// Parameters:
    /// - account_id: The address of the account to add funds for
    /// - amount: The amount of funds to add
    public fun add_splittable<CoinType>(
        account_id: address, amount: u128
    ) acquires SplitsStore {
        // Ensure the SplitsStore exists for this account
        error_handling::validate_resource_exists<SplitsStore>(
            exists<SplitsStore>(account_id),
            CATEGORY,
            E_SPLITS_STORE_NOT_FOUND
        );

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(account_id);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            // Create a new SplitsBalance
            table::add(
                &mut splits_store.balances,
                coin_type_addr,
                SplitsBalance { splittable: 0, collectable: 0 }
            );
        };

        // Get a mutable reference to the SplitsBalance
        let balance = table::borrow_mut(&mut splits_store.balances, coin_type_addr);

        // ADD: Check for overflow
        error_handling::assert_with_error(
            balance.splittable <= MAX_SPLITS_BALANCE - amount,
            CATEGORY,
            E_INSUFFICIENT_BALANCE
        );

        // Add the amount to the splittable balance
        balance.splittable = balance.splittable + amount;

        // Emit event for funds added
        event::emit(
            FundsAddedEvent {
                account: account_id,
                amount,
                timestamp: timestamp::now_seconds()
            }
        );
    }

    /// Check available splittable funds
    /// This function returns the amount of funds that can be split for a specific coin type
    /// Parameters:
    /// - account_id: The address of the account to check
    /// Returns: The amount of funds that can be split
    public fun splittable<CoinType>(account_id: address): u128 acquires SplitsStore {
        // Ensure the SplitsStore exists for this account
        error_handling::validate_resource_exists<SplitsStore>(
            exists<SplitsStore>(account_id),
            CATEGORY,
            E_SPLITS_STORE_NOT_FOUND
        );

        // Get a reference to the SplitsStore
        let splits_store = borrow_global<SplitsStore>(account_id);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            return 0
        };

        // Get a reference to the SplitsBalance
        let balance = table::borrow(&splits_store.balances, coin_type_addr);

        // Return the splittable balance
        balance.splittable
    }

    /// Check available collectable funds
    /// This function returns the amount of funds that can be collected for a specific coin type
    /// Parameters:
    /// - account_id: The address of the account to check
    /// Returns: The amount of funds that can be collected
    public fun collectable<CoinType>(account_id: address): u128 acquires SplitsStore {
        // Ensure the SplitsStore exists for this account
        error_handling::validate_resource_exists<SplitsStore>(
            exists<SplitsStore>(account_id),
            CATEGORY,
            E_SPLITS_STORE_NOT_FOUND
        );

        // Get a reference to the SplitsStore
        let splits_store = borrow_global<SplitsStore>(account_id);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            return 0
        };

        // Get a reference to the SplitsBalance
        let balance = table::borrow(&splits_store.balances, coin_type_addr);

        // Return the collectable balance
        balance.collectable
    }

    /// Collect split funds
    /// This function collects all available funds for the sender
    /// Parameters:
    /// - sender: The signer of the transaction
    /// Returns: The amount of funds collected
    public fun collect<CoinType>(sender: &signer): u128 acquires SplitsStore {
        let sender_addr = signer::address_of(sender);

        // Ensure the SplitsStore exists for this account
        error_handling::validate_resource_exists<SplitsStore>(
            exists<SplitsStore>(sender_addr),
            CATEGORY,
            E_SPLITS_STORE_NOT_FOUND
        );

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(sender_addr);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            return 0
        };

        // Get a mutable reference to the SplitsBalance
        let balance = table::borrow_mut(&mut splits_store.balances, coin_type_addr);

        // Get the collectable amount
        let collectible_amount = balance.collectable;

        // If there's nothing to collect, return early
        if (collectible_amount == 0) {
            return 0
        };

        // Reset the collectable balance
        balance.collectable = 0;

        // Create and deposit coins to the sender's account
        if (collectible_amount > 0) {
            // Convert from u128 to u64 for coin operations
            let amount_u64 = (collectible_amount as u64);

            // Register the account for the coin type if not already registered
            if (!coin::is_account_registered<CoinType>(sender_addr)) {
                coin::register<CoinType>(sender);
            };

            // In a real implementation, we would need proper module account management
            // For now, we'll emit an event to indicate the collection
            event::emit(
                FundsCollectedEvent {
                    receiver: sender_addr,
                    amount: collectible_amount,
                    timestamp: timestamp::now_seconds()
                }
            );
        };

        // Emit event for funds collection
        event::emit(
            FundsCollectedEvent {
                receiver: sender_addr,
                amount: collectible_amount,
                timestamp: timestamp::now_seconds()
            }
        );

        collectible_amount
    }

    /// Collect split funds and transfer them to a specific address
    /// This function collects all available funds for the sender and transfers them to the specified address
    /// Parameters:
    /// - sender: The signer of the transaction
    /// - to: The address to transfer the collected funds to
    /// Returns: The amount of funds collected
    public fun collect_to<CoinType>(sender: &signer, to: address): u128 acquires SplitsStore {
        let sender_addr = signer::address_of(sender);

        // Ensure the SplitsStore exists for this account
        error_handling::validate_resource_exists<SplitsStore>(
            exists<SplitsStore>(sender_addr),
            CATEGORY,
            E_SPLITS_STORE_NOT_FOUND
        );

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(sender_addr);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            return 0
        };

        // Get a mutable reference to the SplitsBalance
        let balance = table::borrow_mut(&mut splits_store.balances, coin_type_addr);

        // Get the collectable amount
        let collectible_amount = balance.collectable;

        // If there's nothing to collect, return early
        if (collectible_amount == 0) {
            return 0
        };

        // Reset the collectable balance
        balance.collectable = 0;

        // Create and deposit coins to the specified address
        if (collectible_amount > 0) {
            // Convert from u128 to u64 for coin operations
            let amount_u64 = (collectible_amount as u64);

            // Register the account for the coin type if not already registered
            if (!coin::is_account_registered<CoinType>(to)) {
                // We can't register the recipient's account directly if they're not the sender
                // In a real implementation, we might want to handle this differently
                // For now, we'll just check if they're already registered
                assert!(coin::is_account_registered<CoinType>(to), E_UNAUTHORIZED);
            };

            // In a real implementation, we would need proper module account management
            // For now, we'll emit an event to indicate the collection
            // In a real implementation, we would need proper module account management
            // For now, we'll emit an event to indicate the collection intent
        };

        // Emit event for funds collection
        event::emit(
            FundsCollectedEvent {
                receiver: to,
                amount: collectible_amount,
                timestamp: timestamp::now_seconds()
            }
        );

        collectible_amount
    }

    /// Check if a SplitsStore exists for an account
    public fun exists_store(account: address): bool {
        exists<SplitsStore>(account)
    }

    /// Get TOTAL_SPLITS_WEIGHT constant
    public fun get_total_splits_weight(): u32 {
        TOTAL_SPLITS_WEIGHT
    }

    /// Get the splits receivers for an account
    public fun get_receivers(account: address): vector<SplitsReceiver> acquires SplitsStore {
        assert!(exists<SplitsStore>(account), E_SPLITS_STORE_NOT_FOUND);

        let splits_store = borrow_global<SplitsStore>(account);
        splits_store.receivers
    }

    /// Collect funds for a specific account (used by drivers)
    /// This function collects funds for the given account ID
    public fun collect_for_account<CoinType>(account_id: u256): u128 acquires SplitsStore {
        // Use a placeholder address for now - in real implementation, derive from account_id
        let account_addr = @0x1;

        // Check if SplitsStore exists for this account
        if (!exists<SplitsStore>(account_addr)) {
            return 0
        };

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(account_addr);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            return 0
        };

        // Get a mutable reference to the SplitsBalance
        let balance = table::borrow_mut(&mut splits_store.balances, coin_type_addr);

        // Get the collectable amount
        let collectible_amount = balance.collectable;

        // If there's nothing to collect, return early
        if (collectible_amount == 0) {
            return 0
        };

        // Reset the collectable balance
        balance.collectable = 0;

        collectible_amount
    }

    /// Add funds to splittable balance for a specific account (used by drivers)
    /// This function adds funds to the splittable balance for the given account ID
    public fun add_splittable_for_account<CoinType>(
        account_id: u256, amount: u128
    ) acquires SplitsStore {
        // Use a placeholder address for now - in real implementation, derive from account_id
        let account_addr = @0x1;

        // Check if SplitsStore exists for this account
        if (!exists<SplitsStore>(account_addr)) { return };

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(account_addr);

        // Get the coin type address
        let coin_type_addr = get_coin_address<CoinType>();

        // Check if the balance exists for this coin type
        if (!table::contains(&splits_store.balances, coin_type_addr)) {
            // Create a new SplitsBalance
            table::add(
                &mut splits_store.balances,
                coin_type_addr,
                SplitsBalance { splittable: 0, collectable: 0 }
            );
        };

        // Get a mutable reference to the SplitsBalance
        let balance = table::borrow_mut(&mut splits_store.balances, coin_type_addr);

        // Add the amount to the splittable balance
        balance.splittable = balance.splittable + amount;
    }

    /// Set splits for a specific account (used by drivers)
    /// This function sets the splits configuration for the given account ID
    public fun set_splits_for_account(
        account_id: u256, receivers: vector<SplitsReceiver>
    ) acquires SplitsStore {
        // Use a placeholder address for now - in real implementation, derive from account_id
        let account_addr = @0x1;

        // Check if SplitsStore exists for this account
        if (!exists<SplitsStore>(account_addr)) { return };

        // Validate receivers
        validate_receivers(account_addr, &receivers);

        // Get a mutable reference to the SplitsStore
        let splits_store = borrow_global_mut<SplitsStore>(account_addr);

        // Update the receivers
        splits_store.receivers = receivers;

        // Update hash
        splits_store.receivers_hash = hash_receivers(&receivers);

        // Emit SplitsSet event
        event::emit(
            SplitsSetEvent {
                account_id: account_addr,
                receivers_hash: splits_store.receivers_hash,
                timestamp: timestamp::now_seconds()
            }
        );
    }

    /// Get the address for a coin type
    /// This is a helper function to get the address for a specific coin type
    /// Parameters:
    /// - CoinType: The coin type to get the address for
    /// Returns: The address for the coin type
    fun get_coin_address<CoinType>(): address {
        // Use type_info to get the actual coin type address
        let type_info = type_info::type_of<CoinType>();
        type_info::account_address(&type_info)
    }

    // Accessor functions for SplitsReceiver fields
    public fun get_splits_receiver_receiver(receiver: &SplitsReceiver): address {
        receiver.receiver
    }

    public fun get_splits_receiver_weight(receiver: &SplitsReceiver): u32 {
        receiver.weight
    }

    // Constructor function for SplitsReceiver
    public fun create_splits_receiver(receiver: address, weight: u32): SplitsReceiver {
        SplitsReceiver { receiver, weight }
    }
}
