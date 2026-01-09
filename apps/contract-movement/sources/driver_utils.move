/// Shared utility functions for building structs from flattened parameters.
/// Used by drips, address_driver, and nft_driver.
module xylkstream::driver_utils {
    use std::vector;
    use xylkstream::streams::{Self, StreamReceiver, StreamsHistory};
    use xylkstream::splits::{Self, SplitsReceiver};

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           ACCOUNT METADATA
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Account metadata key-value pair.
    struct AccountMetadata has copy, drop, store {
        key: vector<u8>,
        value: vector<u8>
    }

    public fun new_account_metadata(key: vector<u8>, value: vector<u8>): AccountMetadata {
        AccountMetadata { key, value }
    }

    public fun account_metadata_key(metadata: &AccountMetadata): vector<u8> {
        metadata.key
    }

    public fun account_metadata_value(metadata: &AccountMetadata): vector<u8> {
        metadata.value
    }

    /// Builds a vector of AccountMetadata from parallel vectors
    public fun build_account_metadata(
        keys: &vector<vector<u8>>,
        values: &vector<vector<u8>>
    ): vector<AccountMetadata> {
        let len = keys.length();
        let metadata = vector::empty<AccountMetadata>();
        let i = 0;
        while (i < len) {
            metadata.push_back(new_account_metadata(keys[i], values[i]));
            i += 1;
        };
        metadata
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           STREAM RECEIVER BUILDERS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Builds a vector of StreamReceiver from parallel vectors
    public fun build_stream_receivers(
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
            receivers.push_back(
                streams::new_stream_receiver(
                    account_ids[i], stream_ids[i], amt_per_secs[i], starts[i], durations[i]
                )
            );
            i += 1;
        };
        receivers
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           SPLITS RECEIVER BUILDERS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Builds a vector of SplitsReceiver from parallel vectors
    public fun build_splits_receivers(
        account_ids: &vector<u256>, weights: &vector<u32>
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

    // ═══════════════════════════════════════════════════════════════════════════════
    //                           STREAMS HISTORY BUILDERS
    // ═══════════════════════════════════════════════════════════════════════════════

    /// Builds a vector of StreamsHistory from parallel vectors
    public fun build_streams_history(
        streams_hashes: &vector<vector<u8>>,
        receiver_account_ids: &vector<vector<u256>>,
        receiver_stream_ids: &vector<vector<u64>>,
        receiver_amt_per_secs: &vector<vector<u256>>,
        receiver_starts: &vector<vector<u64>>,
        receiver_durations: &vector<vector<u64>>,
        update_times: &vector<u64>,
        max_ends: &vector<u64>
    ): vector<StreamsHistory> {
        let len = update_times.length();
        let history = vector::empty<StreamsHistory>();
        let i = 0;
        while (i < len) {
            let receivers =
                build_stream_receivers(
                    &receiver_account_ids[i],
                    &receiver_stream_ids[i],
                    &receiver_amt_per_secs[i],
                    &receiver_starts[i],
                    &receiver_durations[i]
                );
            history.push_back(
                streams::new_streams_history(
                    streams_hashes[i], receivers, update_times[i], max_ends[i]
                )
            );
            i += 1;
        };
        history
    }
}

