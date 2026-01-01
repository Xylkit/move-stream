/// A driver implementing account identification based on wallet addresses.
/// Each address can use Drips with a single account ID derived from that address.
/// No registration is required, an address can start using Drips immediately.
module xylkit::address_driver {
    use std::signer;
    use aptos_std::type_info::TypeInfo;
    use xylkit::drips::{Self, AccountMetadata};
    use xylkit::streams;
    use xylkit::splits;
    use xylkit::driver_transfer_utils;

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
        assert!(addr == @xylkit, E_NOT_DEPLOYER);
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
        let storage = borrow_global<AddressDriverStorage>(@xylkit);
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
    /// `token_type`: The token type to collect\
    /// `transfer_to`: The address to send collected funds to
    public entry fun collect(
        caller: &signer, token_type: TypeInfo, transfer_to: address
    ) acquires AddressDriverStorage {
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
    /// `token_type`: The token type to give\
    /// `amt`: The amount to give
    public entry fun give(
        caller: &signer,
        receiver: u256,
        token_type: TypeInfo,
        amt: u128
    ) acquires AddressDriverStorage {
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
    /// `token_type`: The token type for streaming\
    /// `curr_receivers`: The current streams receivers list\
    /// `balance_delta`: The streams balance change (positive to add, negative to remove)\
    /// `new_receivers`: The new streams receivers list\
    /// `max_end_hint1`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `max_end_hint2`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `transfer_to`: The address to send funds to if balance decreases
    public entry fun set_streams(
        caller: &signer,
        token_type: TypeInfo,
        curr_receivers: vector<streams::StreamReceiver>,
        balance_delta: i128,
        new_receivers: vector<streams::StreamReceiver>,
        max_end_hint1: u64,
        max_end_hint2: u64,
        transfer_to: address
    ) acquires AddressDriverStorage {
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
    /// `receivers`: The list of splits receivers to set
    public entry fun set_splits(
        caller: &signer, receivers: vector<splits::SplitsReceiver>
    ) acquires AddressDriverStorage {
        drips::set_splits(caller_account_id(caller), &receivers);
    }

    /// Emits the caller's account metadata for off-chain indexing.
    /// The keys and values are not standardized by the protocol — it's up to users
    /// to establish conventions for compatibility with consumers.
    ///
    /// `caller`: The signer emitting metadata\
    /// `account_metadata`: The metadata key-value pairs to emit
    public entry fun emit_account_metadata(
        caller: &signer, account_metadata: vector<AccountMetadata>
    ) acquires AddressDriverStorage {
        drips::emit_account_metadata(caller_account_id(caller), account_metadata);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Returns the driver ID assigned to this driver.
    public fun driver_id(): u32 acquires AddressDriverStorage {
        borrow_global<AddressDriverStorage>(@xylkit).driver_id
    }
}

