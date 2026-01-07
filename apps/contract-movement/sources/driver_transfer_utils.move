/// Token transfer utilities for drivers.
/// Encapsulates the logic for token transfers made by drivers implementing user identities.
/// All funds going into Drips are transferred ad-hoc from the caller,
/// and all funds going out of Drips are transferred in full to the provided address.
module xylkstream::driver_transfer_utils {
    use aptos_std::type_info::TypeInfo;
    use aptos_framework::object;
    use aptos_framework::fungible_asset::Metadata;
    use aptos_framework::primary_fungible_store;
    use xylkstream::drips;
    use xylkstream::streams;
    use movemate::i128::{Self, I128};

    // ═══════════════════════════════════════════════════════════════════════════════
    //                              TRANSFER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Collects the account's received already split funds
    /// and transfers them out of the Drips contract.
    ///
    /// `account_id`: The account ID to collect for\
    /// `token_type`: The token type (FA Metadata address)\
    /// `transfer_to`: The address to send collected funds to
    ///
    /// Returns: The collected amount
    public fun collect_and_transfer(
        account_id: u256, token_type: TypeInfo, transfer_to: address
    ): u128 {
        let amt = drips::collect(account_id, token_type);
        if (amt > 0) {
            drips::withdraw(token_type, transfer_to, amt);
        };
        amt
    }

    /// Gives funds from the caller to the receiver.
    /// The receiver can split and collect them immediately.
    /// Transfers the funds to be given from the caller's wallet to the Drips vault.
    ///
    /// `caller`: The signer giving funds\
    /// `account_id`: The giving account ID\
    /// `receiver`: The receiver account ID\
    /// `token_type`: The token type (FA Metadata address)\
    /// `amt`: The amount to give
    public fun give_and_transfer(
        caller: &signer,
        account_id: u256,
        receiver: u256,
        token_type: TypeInfo,
        amt: u128
    ) {
        if (amt > 0) {
            transfer_to_drips(caller, token_type, amt);
        };
        drips::give(account_id, receiver, token_type, amt);
    }

    /// Sets the account's streams configuration.
    /// Transfers funds between the caller's wallet and the Drips contract
    /// to fulfil the change of the streams balance.
    ///
    /// `caller`: The signer setting streams\
    /// `account_id`: The account ID\
    /// `token_type`: The token type (FA Metadata address)\
    /// `curr_receivers`: The current streams receivers list\
    /// `balance_delta`: The streams balance change (positive to add, negative to remove)\
    /// `new_receivers`: The new streams receivers list\
    /// `max_end_hint1`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `max_end_hint2`: Optional hint for gas optimization (pass 0 to ignore)\
    /// `transfer_to`: The address to send funds to if balance decreases
    ///
    /// Returns: The actually applied streams balance change
    public fun set_streams_and_transfer(
        caller: &signer,
        account_id: u256,
        token_type: TypeInfo,
        curr_receivers: &vector<streams::StreamReceiver>,
        balance_delta: I128,
        new_receivers: &vector<streams::StreamReceiver>,
        max_end_hint1: u64,
        max_end_hint2: u64,
        transfer_to: address
    ): I128 {
        if (!i128::is_neg(&balance_delta)) {
            transfer_to_drips(caller, token_type, i128::as_u128(&balance_delta));
        };

        let real_balance_delta =
            drips::set_streams(
                account_id,
                token_type,
                curr_receivers,
                balance_delta,
                new_receivers,
                max_end_hint1,
                max_end_hint2
            );

        if (i128::is_neg(&real_balance_delta)) {
            let neg_delta = i128::neg(&real_balance_delta);
            drips::withdraw(token_type, transfer_to, i128::as_u128(&neg_delta));
        };

        real_balance_delta
    }

    /// Transfers tokens from the caller to the Drips vault.
    ///
    /// `caller`: The signer transferring tokens\
    /// `token_type`: The token type (FA Metadata address)\
    /// `amt`: The amount to transfer
    public fun transfer_to_drips(
        caller: &signer, token_type: TypeInfo, amt: u128
    ) {
        let metadata = object::address_to_object<Metadata>(token_type.account_address());
        primary_fungible_store::transfer(
            caller,
            metadata,
            drips::vault_address(),
            (amt as u64)
        );
    }
}

