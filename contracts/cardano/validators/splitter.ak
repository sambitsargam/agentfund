use agentfund/split.{Share, Unit}
use agentfund/split_test.{
  alice, atlas, bob, locked_input, pay, shares, units, usdm, usdm_masumi,
  usdm_x402,
}
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/assets
use cardano/transaction.{OutputReference, Transaction}

/// Every payment to Atlas is locked here. Anyone may spend it, but only in a transaction
/// that pays each investor their share and Atlas the rest. The deal (Atlas, investors,
/// assets) is a script parameter, so it is part of the address and cannot change after funding.
///
/// The datum is ignored: x402 `script` payments attach a receipt datum, while `default`
/// payments and Masumi escrow collections arrive without one.
validator splitter(
  atlas: VerificationKeyHash,
  investors: List<Share>,
  units: List<Unit>,
) {
  spend(
    _datum: Option<Data>,
    _redeemer: Data,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(own_input) = list.find(
      self.inputs,
      fn(input) { input.output_reference == own_ref },
    )
    let own = own_input.output.address.payment_credential
    // The ledger runs this script once per locked input. Only the first locked input does
    // the whole-transaction split check; it is always present, so the check runs exactly once.
    expect Some(first) = list.find(
      self.inputs,
      fn(input) { input.output.address.payment_credential == own },
    )
    if first.output_reference == own_ref {
      split.is_split(self.inputs, self.outputs, own, atlas, investors, units)
    } else {
      True
    }
  }

  else(_) {
    fail
  }
}

// Validator-level tests -------------------------------------------------------

fn both_units(x402: Int, masumi: Int) {
  usdm(usdm_x402, x402) |> assets.merge(usdm(usdm_masumi, masumi))
}

/// A transaction that spends `n` locked inputs, each holding 1 tUSDM of each unit, split correctly.
fn distribution(n: Int) -> Transaction {
  let total = n * 1_000_000
  Transaction {
    ..transaction.placeholder,
    inputs: list.map(
      list.range(0, n - 1),
      fn(i) { locked_input(i, both_units(1_000_000, 1_000_000)) },
    ),
    outputs: [
      pay(alice, both_units(total / 10, total / 10)),
      pay(bob, both_units(total / 20, total / 20)),
      pay(
        atlas,
        both_units(
          total - total / 10 - total / 20,
          total - total / 10 - total / 20,
        ),
      ),
    ],
  }
}

fn own_ref() -> OutputReference {
  OutputReference { transaction_id: #"aa", output_index: 0 }
}

test spend_with_no_datum() {
  splitter.spend(atlas, shares, units, None, Void, own_ref(), distribution(1))
}

test spend_with_inline_receipt_datum() {
  splitter.spend(
    atlas,
    shares,
    units,
    Some(as_data(#"72657175657374")),
    Void,
    own_ref(),
    distribution(1),
  )
}

test spend_with_unknown_own_ref_fails() fail {
  splitter.spend(
    atlas,
    shares,
    units,
    None,
    Void,
    OutputReference { transaction_id: #"dd", output_index: 9 },
    distribution(1),
  )
}

test budget_1_input() {
  splitter.spend(atlas, shares, units, None, Void, own_ref(), distribution(1))
}

test budget_5_inputs() {
  splitter.spend(atlas, shares, units, None, Void, own_ref(), distribution(5))
}

test budget_10_inputs() {
  splitter.spend(atlas, shares, units, None, Void, own_ref(), distribution(10))
}

test budget_10_inputs_non_first() {
  splitter.spend(
    atlas,
    shares,
    units,
    None,
    Void,
    OutputReference { transaction_id: #"aa", output_index: 9 },
    distribution(10),
  )
}

/// A later input cannot skip the check on its own: the first input's run still rejects the batch.
test short_paid_batch_fails_on_first_input() fail {
  let tx = distribution(3)
  splitter.spend(
    atlas,
    shares,
    units,
    None,
    Void,
    own_ref(),
    Transaction {
      ..tx,
      outputs: [pay(atlas, both_units(3_000_000, 3_000_000))],
    },
  )
}

test budget_20_inputs() {
  splitter.spend(atlas, shares, units, None, Void, own_ref(), distribution(20))
}
