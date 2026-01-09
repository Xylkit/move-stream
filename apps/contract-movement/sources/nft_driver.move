/// A driver implementing token-based account identification.
/// Anybody can mint a new token and create a new identity.
/// Only the current holder of the token can control its account ID.
module xylkstream::nft_driver {
    use std::signer;
    use std::option;
    use std::string::{Self, String};
    use aptos_std::smart_table::{Self, SmartTable};
    use aptos_framework::object::{Self, ExtendRef};
    use aptos_token_objects::collection;
    use aptos_token_objects::token;
    use xylkstream::drips;
    use xylkstream::driver_utils::{Self, AccountMetadata};
    use xylkstream::driver_transfer_utils;
    use movemate::i128;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                 CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════

    const NFT_DRIVER_ID: u32 = 2;
    const MINTER_MASK: u256 =
        0x000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    const COLLECTION_NAME: vector<u8> = b"Drips Identity";
    const COLLECTION_DESCRIPTION: vector<u8> = b"NFT-based identity for Drips protocol";
    const COLLECTION_URI: vector<u8> = b"";

    // ═══════════════════════════════════════════════════════════════════════════════
    //                                 ERROR CODES
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Storage already initialized
    const E_ALREADY_INITIALIZED: u64 = 100;
    /// Caller is not the token owner
    const E_NOT_TOKEN_OWNER: u64 = 102;
    /// Salt has already been used by this minter
    const E_SALT_ALREADY_USED: u64 = 103;
    /// Token does not exist (already burned or never minted)
    const E_TOKEN_NOT_FOUND: u64 = 104;

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              STORAGE
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Global storage for the NFT driver configuration.
    struct NFTDriverStorage has key {
        /// The driver ID assigned to this driver.
        driver_id: u32,
        /// The number of tokens minted without salt.
        minted_tokens: u64,
        /// The salts already used for minting tokens: minter -> salt -> bool.
        used_salts: SmartTable<address, SmartTable<u64, bool>>,
        /// Extend ref for the collection (to mint new tokens).
        collection_extend_ref: ExtendRef,
        /// Mapping from token_id to token object address.
        token_addresses: SmartTable<u256, address>
    }

    /// Token data stored in each NFT object.
    struct DripsIdentityToken has key {
        /// The token ID (equal to account ID).
        token_id: u256,
        /// Extend ref for the token.
        extend_ref: ExtendRef,
        /// Burn ref for the token (to allow burning).
        burn_ref: token::BurnRef
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Initialize the NFT driver with the given driver ID.
    /// Creates the NFT collection for Drips identity tokens.
    ///
    /// `deployer`: The deployer signer
    fun init_module(deployer: &signer) {
        let addr = signer::address_of(deployer);
        assert!(!exists<NFTDriverStorage>(addr), E_ALREADY_INITIALIZED);

        let collection_constructor_ref =
            collection::create_unlimited_collection(
                deployer,
                string::utf8(COLLECTION_DESCRIPTION),
                string::utf8(COLLECTION_NAME),
                option::none(),
                string::utf8(COLLECTION_URI)
            );
        let collection_extend_ref =
            object::generate_extend_ref(&collection_constructor_ref);

        move_to(
            deployer,
            NFTDriverStorage {
                driver_id: NFT_DRIVER_ID,
                minted_tokens: 0,
                used_salts: smart_table::new(),
                collection_extend_ref,
                token_addresses: smart_table::new()
            }
        );
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              TOKEN ID CALCULATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Get the ID of the next minted token (without salt).
    /// Every token ID is a 256-bit integer constructed by concatenating:
    /// `driverId (32 bits) | zeros (160 bits) | mintedTokensCounter (64 bits)`.
    ///
    /// Returns: The token ID (equal to the account ID controlled by it)
    public fun next_token_id(): u256 acquires NFTDriverStorage {
        let storage = borrow_global<NFTDriverStorage>(@xylkstream);
        calc_token_id_with_salt_internal(storage.driver_id, @0x0, storage.minted_tokens)
    }

    /// Calculate the ID of the token minted with salt.
    /// Every token ID is a 256-bit integer constructed by concatenating:
    /// `driverId (32 bits) | minter (160 bits) | salt (64 bits)`.
    ///
    /// `minter`: The minter of the token\
    /// `salt`: The salt used for minting the token
    ///
    /// Returns: The token ID (equal to the account ID controlled by it)
    public fun calc_token_id_with_salt(minter: address, salt: u64): u256 acquires NFTDriverStorage {
        let storage = borrow_global<NFTDriverStorage>(@xylkstream);
        calc_token_id_with_salt_internal(storage.driver_id, minter, salt)
    }

    /// Internal token ID calculation.
    fun calc_token_id_with_salt_internal(
        driver_id: u32, minter: address, salt: u64
    ): u256 {
        let token_id = (driver_id as u256);
        token_id = (token_id << 160) | (addr_to_u256(minter) & MINTER_MASK);
        token_id = (token_id << 64) | (salt as u256);
        token_id
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

    /// Checks if the salt has already been used for minting a token.
    ///
    /// `minter`: The minter of the token\
    /// `salt`: The salt used for minting the token
    ///
    /// Returns: True if the salt has been used, false otherwise
    public fun is_salt_used(minter: address, salt: u64): bool acquires NFTDriverStorage {
        let storage = borrow_global<NFTDriverStorage>(@xylkstream);
        if (!storage.used_salts.contains(minter)) {
            return false
        };
        let minter_salts = storage.used_salts.borrow(minter);
        minter_salts.contains(salt)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              MINTING
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Mints a new token controlling a new account ID and transfers it to an address.
    /// Emits account metadata for the new token.
    ///
    /// `caller`: The minter\
    /// `to`: The address to transfer the minted token to\
    /// `metadata_keys`: The metadata keys to emit\
    /// `metadata_values`: The metadata values to emit
    ///
    /// Returns: The minted token ID (equal to the account ID controlled by it)
    public entry fun mint(
        caller: &signer,
        to: address,
        metadata_keys: vector<vector<u8>>,
        metadata_values: vector<vector<u8>>
    ) acquires NFTDriverStorage {
        let account_metadata =
            driver_utils::build_account_metadata(&metadata_keys, &metadata_values);
        let storage = borrow_global_mut<NFTDriverStorage>(@xylkstream);
        let token_id =
            calc_token_id_with_salt_internal(
                storage.driver_id, @0x0, storage.minted_tokens
            );
        storage.minted_tokens += 1;
        mint_internal(caller, to, token_id, account_metadata);
    }

    /// Mints a new token controlling a new account ID and transfers it to an address.
    /// The token ID is deterministically derived from the caller's address and the salt.
    /// Each caller can use each salt only once, to mint a single token.
    /// Emits account metadata for the new token.
    ///
    /// `caller`: The minter\
    /// `salt`: The salt to use for token ID calculation\
    /// `to`: The address to transfer the minted token to\
    /// `metadata_keys`: The metadata keys to emit\
    /// `metadata_values`: The metadata values to emit
    ///
    /// Returns: The minted token ID (equal to the account ID controlled by it).
    ///          The ID is calculated using `calc_token_id_with_salt` for the caller's address and the used salt.
    public entry fun mint_with_salt(
        caller: &signer,
        salt: u64,
        to: address,
        metadata_keys: vector<vector<u8>>,
        metadata_values: vector<vector<u8>>
    ) acquires NFTDriverStorage {
        let account_metadata =
            driver_utils::build_account_metadata(&metadata_keys, &metadata_values);
        let minter = signer::address_of(caller);
        assert!(!is_salt_used(minter, salt), E_SALT_ALREADY_USED);

        let storage = borrow_global_mut<NFTDriverStorage>(@xylkstream);
        if (!storage.used_salts.contains(minter)) {
            storage.used_salts.add(minter, smart_table::new());
        };
        let minter_salts = storage.used_salts.borrow_mut(minter);
        minter_salts.add(salt, true);

        let token_id = calc_token_id_with_salt_internal(storage.driver_id, minter, salt);
        mint_internal(caller, to, token_id, account_metadata);
    }

    /// Internal mint function that creates the token and transfers it.
    fun mint_internal(
        caller: &signer,
        to: address,
        token_id: u256,
        account_metadata: vector<AccountMetadata>
    ) acquires NFTDriverStorage {
        let storage = borrow_global_mut<NFTDriverStorage>(@xylkstream);
        let token_name = string::utf8(b"Drips Identity #");
        token_name.append(u256_to_string(token_id));

        let token_constructor_ref =
            token::create_named_token(
                caller,
                string::utf8(COLLECTION_NAME),
                string::utf8(b""),
                token_name,
                option::none(),
                string::utf8(b"")
            );

        let token_signer = object::generate_signer(&token_constructor_ref);
        let extend_ref = object::generate_extend_ref(&token_constructor_ref);
        let burn_ref = token::generate_burn_ref(&token_constructor_ref);
        let token_address = object::address_from_constructor_ref(&token_constructor_ref);

        move_to(
            &token_signer,
            DripsIdentityToken { token_id, extend_ref, burn_ref }
        );
        storage.token_addresses.add(token_id, token_address);

        let caller_addr = signer::address_of(caller);
        if (to != caller_addr) {
            object::transfer(
                caller,
                object::object_from_constructor_ref<token::Token>(&token_constructor_ref),
                to
            );
        };
        emit_account_metadata_internal(token_id, account_metadata);
    }

    /// Converts u256 to string.
    fun u256_to_string(value: u256): String {
        if (value == 0) {
            return string::utf8(b"0")
        };
        let buffer = std::vector::empty<u8>();
        let n = value;
        while (n > 0) {
            let digit = ((n % 10) as u8) + 48;
            buffer.push_back(digit);
            n = n / 10;
        };
        buffer.reverse();
        string::utf8(buffer)
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              OWNERSHIP VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Verifies that the caller owns the token with the given token_id.
    fun assert_token_owner(caller: &signer, token_id: u256) acquires NFTDriverStorage {
        let storage = borrow_global<NFTDriverStorage>(@xylkstream);
        assert!(storage.token_addresses.contains(token_id), E_NOT_TOKEN_OWNER);
        let token_address = *storage.token_addresses.borrow(token_id);
        let token_object = object::address_to_object<DripsIdentityToken>(token_address);
        let owner = object::owner(token_object);
        assert!(signer::address_of(caller) == owner, E_NOT_TOKEN_OWNER);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              DRIPS OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Collects the account's received already split funds
    /// and transfers them out of the Drips contract.
    ///
    /// `caller`: The token owner. Must be the owner of the token or approved to use it.\
    /// `token_id`: The ID of the token representing the collecting account ID.
    ///             The token ID is equal to the account ID controlled by it.\
    /// `fa_metadata`: The address of FA in use\
    /// `transfer_to`: The address to send collected funds to
    ///
    /// Returns: The collected amount
    public entry fun collect(
        caller: &signer,
        token_id: u256,
        fa_metadata: address,
        transfer_to: address
    ) acquires NFTDriverStorage {
        assert_token_owner(caller, token_id);
        driver_transfer_utils::collect_and_transfer(token_id, fa_metadata, transfer_to);
    }

    /// Gives funds from the account to the receiver.
    /// The receiver can split and collect them immediately.
    /// Transfers the funds to be given from the message sender's wallet to the Drips contract.
    ///
    /// `caller`: The token owner. Must be the owner of the token or approved to use it.\
    /// `token_id`: The ID of the token representing the giving account ID.
    ///             The token ID is equal to the account ID controlled by it.\
    /// `receiver`: The receiver account ID.\
    /// `fa_metadata`: The address of FA in use\
    /// `amt`: The given amount
    public entry fun give(
        caller: &signer,
        token_id: u256,
        receiver: u256,
        fa_metadata: address,
        amt: u128
    ) acquires NFTDriverStorage {
        assert_token_owner(caller, token_id);
        driver_transfer_utils::give_and_transfer(
            caller, token_id, receiver, fa_metadata, amt
        );
    }

    /// Sets the account's streams configuration.
    /// Transfers funds between the message sender's wallet and the Drips contract
    /// to fulfil the change of the streams balance.
    ///
    /// `caller`: The token owner. Must be the owner of the token or approved to use it.\
    /// `token_id`: The ID of the token representing the configured account ID.\
    /// `fa_metadata`: The address of FA in use\
    /// `curr_receiver_account_ids`: Current receivers' account IDs\
    /// `curr_receiver_stream_ids`: Current receivers' stream IDs\
    /// `curr_receiver_amt_per_secs`: Current receivers' amt_per_sec values\
    /// `curr_receiver_starts`: Current receivers' start times\
    /// `curr_receiver_durations`: Current receivers' durations\
    /// `balance_delta`: The streams balance change\
    /// `new_receiver_account_ids`: New receivers' account IDs\
    /// `new_receiver_stream_ids`: New receivers' stream IDs\
    /// `new_receiver_amt_per_secs`: New receivers' amt_per_sec values\
    /// `new_receiver_starts`: New receivers' start times\
    /// `new_receiver_durations`: New receivers' durations\
    /// `max_end_hint1`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `max_end_hint2`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `transfer_to`: The address to send funds to in case of decreasing balance
    public entry fun set_streams(
        caller: &signer,
        token_id: u256,
        fa_metadata: address,
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
    ) acquires NFTDriverStorage {
        assert_token_owner(caller, token_id);
        let curr_receivers =
            driver_utils::build_stream_receivers(
                &curr_receiver_account_ids,
                &curr_receiver_stream_ids,
                &curr_receiver_amt_per_secs,
                &curr_receiver_starts,
                &curr_receiver_durations
            );
        let new_receivers =
            driver_utils::build_stream_receivers(
                &new_receiver_account_ids,
                &new_receiver_stream_ids,
                &new_receiver_amt_per_secs,
                &new_receiver_starts,
                &new_receiver_durations
            );
        let balance_delta = i128::from_bits(balance_delta_bits);
        driver_transfer_utils::set_streams_and_transfer(
            caller,
            token_id,
            fa_metadata,
            &curr_receivers,
            balance_delta,
            &new_receivers,
            max_end_hint1,
            max_end_hint2,
            transfer_to
        );
    }

    /// Sets the account splits configuration.
    /// The configuration is common for all token types.
    ///
    /// `caller`: The token owner. Must be the owner of the token or approved to use it.\
    /// `token_id`: The ID of the token representing the configured account ID.\
    /// `receiver_account_ids`: The receivers' account IDs\
    /// `receiver_weights`: The receivers' weights
    public entry fun set_splits(
        caller: &signer,
        token_id: u256,
        receiver_account_ids: vector<u256>,
        receiver_weights: vector<u32>
    ) acquires NFTDriverStorage {
        assert_token_owner(caller, token_id);
        let receivers =
            driver_utils::build_splits_receivers(
                &receiver_account_ids, &receiver_weights
            );
        drips::set_splits(token_id, &receivers);
    }

    /// Emits account metadata for the given token.
    ///
    /// `caller`: The token owner\
    /// `token_id`: The token ID (equal to account ID)\
    /// `keys`: The metadata keys\
    /// `values`: The metadata values
    public entry fun emit_account_metadata(
        caller: &signer,
        token_id: u256,
        keys: vector<vector<u8>>,
        values: vector<vector<u8>>
    ) acquires NFTDriverStorage {
        assert_token_owner(caller, token_id);
        let account_metadata = driver_utils::build_account_metadata(&keys, &values);
        emit_account_metadata_internal(token_id, account_metadata);
    }

    /// Internal function to emit account metadata.
    /// The keys and the values are not standardized by the protocol, it's up to the users
    /// to establish and follow conventions to ensure compatibility with the consumers.
    fun emit_account_metadata_internal(
        token_id: u256, account_metadata: vector<AccountMetadata>
    ) {
        if (account_metadata.length() == 0) { return };
        drips::emit_account_metadata(token_id, account_metadata);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              TOKEN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Burns the token controlling an account.
    /// This freezes the account configuration and prevents any funds
    /// from being deposited to or withdrawn from the protocol using that account.
    ///
    /// `caller`: The token owner\
    /// `token_id`: The token ID (equal to account ID)
    public entry fun burn(
        caller: &signer, token_id: u256
    ) acquires NFTDriverStorage, DripsIdentityToken {
        assert_token_owner(caller, token_id);
        let storage = borrow_global_mut<NFTDriverStorage>(@xylkstream);
        let token_address = storage.token_addresses.remove(token_id);
        let DripsIdentityToken { token_id: _, extend_ref: _, burn_ref } =
            move_from<DripsIdentityToken>(token_address);
        token::burn(burn_ref);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[view]
    public fun driver_id(): u32 acquires NFTDriverStorage {
        borrow_global<NFTDriverStorage>(@xylkstream).driver_id
    }

    #[view]
    /// Returns the number of tokens minted without salt.
    public fun minted_tokens(): u64 acquires NFTDriverStorage {
        borrow_global<NFTDriverStorage>(@xylkstream).minted_tokens
    }

    #[view]
    /// Returns the token address for a given token ID.
    /// Returns none if the token doesn't exist.
    public fun token_address(token_id: u256): option::Option<address> acquires NFTDriverStorage {
        let storage = borrow_global<NFTDriverStorage>(@xylkstream);
        if (storage.token_addresses.contains(token_id)) {
            option::some(*storage.token_addresses.borrow(token_id))
        } else {
            option::none()
        }
    }

    #[view]
    /// Returns the owner of a token.
    /// Aborts if the token doesn't exist.
    public fun owner_of(token_id: u256): address acquires NFTDriverStorage {
        let storage = borrow_global<NFTDriverStorage>(@xylkstream);
        assert!(storage.token_addresses.contains(token_id), E_TOKEN_NOT_FOUND);
        let token_address = *storage.token_addresses.borrow(token_id);
        let token_object = object::address_to_object<DripsIdentityToken>(token_address);
        object::owner(token_object)
    }
}

