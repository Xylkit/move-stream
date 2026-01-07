/// A driver implementing account identification based on wallet addresses.
/// Each address can use Drips with a single account ID derived from that address.
/// No registration is required, an address can start using Drips immediately.
module xylkstream::address_driver {
    use std::signer;
    use std::vector;
    use aptos_std::type_info;
    use xylkstream::drips::{Self, AccountMetadata};
    use xylkstream::streams::{Self, StreamReceiver};
    use xylkstream::splits::{Self, SplitsReceiver};
    use xylkstream::driver_transfer_utils;
    use movemate::i128;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                 CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// The offset of the driver ID in the account ID.
    /// Account ID = driverId (32 bits) | addr_lower (224 bits).
    const DRIVER_ID_OFFSET: u8 = 224;

    /// Mask for the lower 224 bits of the address.
    /// Zeros out the top 32 bits to leave room for driver ID.
    const ADDR_MASK: u256 =
        0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                 ERROR CODES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Storage already initialized
    const E_ALREADY_INITIALIZED: u64 = 100;
    /// Caller is not the deployer
    const E_NOT_DEPLOYER: u64 = 101;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              STORAGE
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Global storage for the address driver configuration.
    struct AddressDriverStorage has key {
        /// The driver ID assigned to this driver.
        driver_id: u32
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Initialize the address driver with the given driver ID.
    /// Must be called once before using the driver.
    ///
    /// `deployer`: The deployer signer\
    /// `driver_id`: The driver ID to assign
    public entry fun initialize(deployer: &signer, driver_id: u32) {
        let addr = signer::address_of(deployer);
        assert!(addr == @xylkstream, E_NOT_DEPLOYER);
        assert!(!exists<AddressDriverStorage>(addr), E_ALREADY_INITIALIZED);
        move_to(deployer, AddressDriverStorage { driver_id });
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              ACCOUNT ID
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Calculates the account ID for an address.
    /// Every account ID is a 256-bit integer constructed by concatenating:
    /// `driverId (32 bits) | addr_lower (224 bits)`.
    ///
    /// `addr`: The address to calculate the account ID for
    ///
    /// Returns: The account ID
    public fun calc_account_id(addr: address): u256 acquires AddressDriverStorage {
        let storage = borrow_global<AddressDriverStorage>(@xylkstream);
        // Shift driver ID to upper 32 bits, OR with masked 224 bits of address
        ((storage.driver_id as u256) << DRIVER_ID_OFFSET) | (
            addr_to_u256(addr) & ADDR_MASK
        )
    }

    /// Returns the account ID for the caller.
    fun caller_account_id(caller: &signer): u256 acquires AddressDriverStorage {
        calc_account_id(signer::address_of(caller))
    }

    /// Converts an address to u256.
    fun addr_to_u256(addr: address): u256 {
        let bytes = std::bcs::to_bytes(&addr);
        let result: u256 = 0;
        let i = 0;
        while (i < 32) {
            result = (result << 8) | (bytes[i] as u256);
            i += 1;
        };
        result
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              DRIPS OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Collects the caller's received already split funds
    /// and transfers them to the specified address.
    ///
    /// `caller`: The signer collecting funds\
    /// `T`: The token type to collect (type parameter)\
    /// `transfer_to`: The address to send collected funds to
    public entry fun collect<T: key>(
        caller: &signer, transfer_to: address
    ) acquires AddressDriverStorage {
        let token_type = type_info::type_of<T>();
        driver_transfer_utils::collect_and_transfer(
            caller_account_id(caller),
            token_type,
            transfer_to
        );
    }

    /// Gives funds from the caller to the receiver.
    /// The receiver can split and collect them immediately.
    /// Transfers the funds from the caller's wallet to the Drips vault.
    ///
    /// `caller`: The signer giving funds\
    /// `receiver`: The receiver account ID\
    /// `T`: The token type to give (type parameter)\
    /// `amt`: The amount to give
    public entry fun give<T: key>(
        caller: &signer,
        receiver: u256,
        amt: u128
    ) acquires AddressDriverStorage {
        let token_type = type_info::type_of<T>();
        driver_transfer_utils::give_and_transfer(
            caller,
            caller_account_id(caller),
            receiver,
            token_type,
            amt
        );
    }

    /// Sets the caller's streams configuration.
    /// Transfers funds between the caller's wallet and the Drips contract
    /// to fulfil the change of the streams balance.
    ///
    /// `caller`: The signer setting streams\
    /// `T`: The token type for streaming (type parameter)\
    /// `curr_receiver_account_ids`: Current receivers' account IDs\
    /// `curr_receiver_stream_ids`: Current receivers' stream IDs\
    /// `curr_receiver_amt_per_secs`: Current receivers' amt_per_sec values\
    /// `curr_receiver_starts`: Current receivers' start times\
    /// `curr_receiver_durations`: Current receivers' durations\
    /// `balance_delta`: The streams balance change (positive to add, negative to remove)\
    /// `new_receiver_account_ids`: New receivers' account IDs\
    /// `new_receiver_stream_ids`: New receivers' stream IDs\
    /// `new_receiver_amt_per_secs`: New receivers' amt_per_sec values\
    /// `new_receiver_starts`: New receivers' start times\
    /// `new_receiver_durations`: New receivers' durations\
    /// `max_end_hint1`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `max_end_hint2`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `transfer_to`: The address to send funds to if balance decreases
    public entry fun set_streams<T: key>(
        caller: &signer,
        curr_receiver_account_ids: vector<u256>,
        curr_receiver_stream_ids: vector<u64>,
        curr_receiver_amt_per_secs: vector<u256>,
        curr_receiver_starts: vector<u64>,
        curr_receiver_durations: vector<u64>,
        balance_delta_bits: u128,
        new_receiver_account_ids: vector<u256>,
        new_receiver_stream_ids: vector<u64>,
        new_receiver_amt_per_secs: vector<u256>,
        new_receiver_starts: vector<u64>,
        new_receiver_durations: vector<u64>,
        max_end_hint1: u64,
        max_end_hint2: u64,
        transfer_to: address
    ) acquires AddressDriverStorage {
        let token_type = type_info::type_of<T>();
        let curr_receivers = build_stream_receivers(
            &curr_receiver_account_ids,
            &curr_receiver_stream_ids,
            &curr_receiver_amt_per_secs,
            &curr_receiver_starts,
            &curr_receiver_durations
        );
        let new_receivers = build_stream_receivers(
            &new_receiver_account_ids,
            &new_receiver_stream_ids,
            &new_receiver_amt_per_secs,
            &new_receiver_starts,
            &new_receiver_durations
        );
        let balance_delta = i128::from_bits(balance_delta_bits);
        driver_transfer_utils::set_streams_and_transfer(
            caller,
            caller_account_id(caller),
            token_type,
            &curr_receivers,
            balance_delta,
            &new_receivers,
            max_end_hint1,
            max_end_hint2,
            transfer_to
        );
    }

    /// Sets the caller's splits configuration.
    /// The configuration is common for all token types.
    /// Nothing happens to the currently splittable funds, but when they are split
    /// after this function finishes, the new splits configuration will be used.
    ///
    /// `caller`: The signer setting splits\
    /// `receiver_account_ids`: The receivers' account IDs\
    /// `receiver_weights`: The receivers' weights
    public entry fun set_splits(
        caller: &signer,
        receiver_account_ids: vector<u256>,
        receiver_weights: vector<u32>
    ) acquires AddressDriverStorage {
        let receivers = build_splits_receivers(&receiver_account_ids, &receiver_weights);
        drips::set_splits(caller_account_id(caller), &receivers);
    }

    /// Emits the caller's account metadata for off-chain indexing.
    /// The keys and values are not standardized by the protocol — it's up to users
    /// to establish conventions for compatibility with consumers.
    ///
    /// `caller`: The signer emitting metadata\
    /// `keys`: The metadata keys\
    /// `values`: The metadata values
    public entry fun emit_account_metadata(
        caller: &signer,
        keys: vector<vector<u8>>,
        values: vector<vector<u8>>
    ) acquires AddressDriverStorage {
        let account_metadata = build_account_metadata(&keys, &values);
        drips::emit_account_metadata(caller_account_id(caller), account_metadata);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Builds a vector of StreamReceiver from parallel vectors
    fun build_stream_receivers(
        account_ids: &vector<u256>,
        stream_ids: &vector<u64>,
        amt_per_secs: &vector<u256>,
        starts: &vector<u64>,
        durations: &vector<u64>
    ): vector<StreamReceiver> {
        let len = account_ids.length();
        let receivers = vector::empty<StreamReceiver>();
        let i = 0;
        while (i < len) {
            receivers.push_back(streams::new_stream_receiver(
                account_ids[i],
                stream_ids[i],
                amt_per_secs[i],
                starts[i],
                durations[i]
            ));
            i += 1;
        };
        receivers
    }

    /// Builds a vector of SplitsReceiver from parallel vectors
    fun build_splits_receivers(
        account_ids: &vector<u256>,
        weights: &vector<u32>
    ): vector<SplitsReceiver> {
        let len = account_ids.length();
        let receivers = vector::empty<SplitsReceiver>();
        let i = 0;
        while (i < len) {
            receivers.push_back(splits::new_splits_receiver(account_ids[i], weights[i]));
            i += 1;
        };
        receivers
    }

    /// Builds a vector of AccountMetadata from parallel vectors
    fun build_account_metadata(
        keys: &vector<vector<u8>>,
        values: &vector<vector<u8>>
    ): vector<AccountMetadata> {
        let len = keys.length();
        let metadata = vector::empty<AccountMetadata>();
        let i = 0;
        while (i < len) {
            metadata.push_back(drips::new_account_metadata(keys[i], values[i]));
            i += 1;
        };
        metadata
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns the driver ID assigned to this driver.
    public fun driver_id(): u32 acquires AddressDriverStorage {
        borrow_global<AddressDriverStorage>(@xylkstream).driver_id
    }
}

