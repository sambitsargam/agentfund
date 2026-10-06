use agentfund/split.{Share, Unit, is_split, shares_are_valid}
use aiken/fuzz
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets.{Value}
use cardano/transaction.{Input, NoDatum, Output, OutputReference}

pub const own_hash = #"5b2a8c0e1f5a4d6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d6e7f809"

pub const atlas = #"e19e60ad4a1406cfccb2234f9a6114ad526bd3cef1bddb0ab516a25b"

pub const alice = #"0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a"

pub const bob = #"0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"

pub const mallory = #"0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c"

pub const usdm_x402 =
  Unit {
    policy: #"e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9",
    name: #"0014df10745553444d",
  }

pub const usdm_masumi =
  Unit {
    policy: #"16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde",
    name: #"0014df10745553444d",
  }

pub const units = [usdm_x402, usdm_masumi]

/// Alice 10%, Bob 5%.
pub const shares = [Share(alice, 1000), Share(bob, 500)]

pub fn usdm(unit: Unit, quantity: Int) -> Value {
  assets.from_lovelace(2_000_000)
    |> assets.add(unit.policy, unit.name, quantity)
}

pub fn locked_input(index: Int, value: Value) -> Input {
  Input {
    output_reference: OutputReference { transaction_id: #"aa", output_index: index },
    output: Output {
      address: Address(Script(own_hash), None),
      value,
      datum: NoDatum,
      reference_script: None,
    },
  }
}

pub fn pay(key: ByteArray, value: Value) -> Output {
  Output {
    address: Address(VerificationKey(key), None),
    value,
    datum: NoDatum,
    reference_script: None,
  }
}

fn check(inputs: List<Input>, outputs: List<Output>) -> Bool {
  is_split(inputs, outputs, Script(own_hash), atlas, shares, units)
}

// One input with 1 tUSDM (x402 unit): Alice 0.1, Bob 0.05, Atlas 0.85.
test correct_split_passes() {
  check(
    [locked_input(0, usdm(usdm_x402, 1_000_000))],
    [
      pay(alice, usdm(usdm_x402, 100_000)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(atlas, usdm(usdm_x402, 850_000)),
    ],
  )
}

test investor_short_paid_fails() fail {
  check(
    [locked_input(0, usdm(usdm_x402, 1_000_000))],
    [
      pay(alice, usdm(usdm_x402, 99_999)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(atlas, usdm(usdm_x402, 850_001)),
    ],
  )
}

test investor_short_paid_in_masumi_unit_fails() fail {
  check(
    [locked_input(0, usdm(usdm_masumi, 1_000_000))],
    [
      pay(alice, usdm(usdm_masumi, 100_000)),
      pay(bob, usdm(usdm_masumi, 49_999)),
      pay(atlas, usdm(usdm_masumi, 850_001)),
    ],
  )
}

test atlas_short_paid_fails() fail {
  check(
    [locked_input(0, usdm(usdm_x402, 1_000_000))],
    [
      pay(alice, usdm(usdm_x402, 100_000)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(atlas, usdm(usdm_x402, 849_999)),
    ],
  )
}

test tokens_to_outsider_fail() fail {
  check(
    [locked_input(0, usdm(usdm_x402, 1_000_000))],
    [
      pay(alice, usdm(usdm_x402, 100_000)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(mallory, usdm(usdm_x402, 850_000)),
    ],
  )
}

test investor_paid_across_several_outputs_passes() {
  check(
    [locked_input(0, usdm(usdm_x402, 1_000_000))],
    [
      pay(alice, usdm(usdm_x402, 60_000)),
      pay(alice, usdm(usdm_x402, 40_000)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(atlas, usdm(usdm_x402, 850_000)),
    ],
  )
}

// Three inputs, both units: x402 total 3_000_000, Masumi total 2_000_000.
test multiple_inputs_mixed_assets_sum_correctly() {
  check(
    [
      locked_input(0, usdm(usdm_x402, 1_000_000)),
      locked_input(1, usdm(usdm_masumi, 2_000_000)),
      locked_input(2, usdm(usdm_x402, 2_000_000)),
    ],
    [
      pay(alice, usdm(usdm_x402, 300_000) |> assets.merge(usdm(usdm_masumi, 200_000))),
      pay(bob, usdm(usdm_x402, 150_000) |> assets.merge(usdm(usdm_masumi, 100_000))),
      pay(atlas, usdm(usdm_x402, 2_550_000) |> assets.merge(usdm(usdm_masumi, 1_700_000))),
    ],
  )
}

// Double satisfaction: two locked inputs, outputs only cover one of them.
test paying_for_one_of_two_inputs_fails() fail {
  check(
    [
      locked_input(0, usdm(usdm_x402, 1_000_000)),
      locked_input(1, usdm(usdm_x402, 1_000_000)),
    ],
    [
      pay(alice, usdm(usdm_x402, 100_000)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(atlas, usdm(usdm_x402, 1_850_000)),
    ],
  )
}

// 7 units at 33.33%: the investor is owed floor(2.3331) = 2, Atlas the remaining 5.
test rounding_dust_goes_to_atlas() {
  is_split(
    [locked_input(0, usdm(usdm_x402, 7))],
    [pay(alice, usdm(usdm_x402, 2)), pay(atlas, usdm(usdm_x402, 5))],
    Script(own_hash),
    atlas,
    [Share(alice, 3333)],
    units,
  )
}

test rounding_dust_cannot_be_dropped() fail {
  is_split(
    [locked_input(0, usdm(usdm_x402, 7))],
    [pay(alice, usdm(usdm_x402, 2)), pay(atlas, usdm(usdm_x402, 4))],
    Script(own_hash),
    atlas,
    [Share(alice, 3333)],
    units,
  )
}

test unlisted_asset_does_not_block_spending() {
  let other = assets.from_asset(#"cc", #"01", 42)
  check(
    [locked_input(0, usdm(usdm_x402, 1_000_000) |> assets.merge(other))],
    [
      pay(alice, usdm(usdm_x402, 100_000)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(atlas, usdm(usdm_x402, 850_000)),
      pay(mallory, other),
    ],
  )
}

test ada_only_input_is_unconstrained() {
  check([locked_input(0, assets.from_lovelace(5_000_000))], [pay(mallory, assets.from_lovelace(4_800_000))])
}

test inputs_at_other_scripts_are_not_counted() {
  let foreign =
    Input {
      output_reference: OutputReference { transaction_id: #"bb", output_index: 0 },
      output: Output {
        address: Address(Script(#"ff"), None),
        value: usdm(usdm_x402, 9_000_000),
        datum: NoDatum,
        reference_script: None,
      },
    }
  check(
    [locked_input(0, usdm(usdm_x402, 1_000_000)), foreign],
    [
      pay(alice, usdm(usdm_x402, 100_000)),
      pay(bob, usdm(usdm_x402, 50_000)),
      pay(atlas, usdm(usdm_x402, 850_000)),
      pay(mallory, usdm(usdm_x402, 9_000_000)),
    ],
  )
}

test shares_over_100_percent_are_rejected() {
  !shares_are_valid([Share(alice, 6000), Share(bob, 5000)])
}

test zero_share_is_rejected() {
  !shares_are_valid([Share(alice, 0)])
}

test exactly_100_percent_is_valid() {
  shares_are_valid([Share(alice, 9999), Share(bob, 1)])
}

// Properties ------------------------------------------------------------------

fn total_and_bps() -> Fuzzer<(Int, Int)> {
  fuzz.both(fuzz.int_between(1, 1_000_000_000_000), fuzz.int_between(1, 10000))
}

/// Paying the investor exactly floor(total * bps / 10000) and Atlas the rest always passes.
test prop_exact_split_passes(case via total_and_bps()) {
  let (total, bps) = case
  let owed = total * bps / 10000
  is_split(
    [locked_input(0, usdm(usdm_masumi, total))],
    [pay(alice, usdm(usdm_masumi, owed)), pay(atlas, usdm(usdm_masumi, total - owed))],
    Script(own_hash),
    atlas,
    [Share(alice, bps)],
    units,
  )
}

/// Moving one unit from the investor to Atlas always fails whenever the investor is owed anything.
test prop_investor_short_by_one_fails(case via total_and_bps()) {
  let (total, bps) = case
  let owed = total * bps / 10000
  if owed == 0 {
    fuzz.label(@"nothing owed")
    True
  } else {
    !is_split(
      [locked_input(0, usdm(usdm_masumi, total))],
      [
        pay(alice, usdm(usdm_masumi, owed - 1)),
        pay(atlas, usdm(usdm_masumi, total - owed + 1)),
      ],
      Script(own_hash),
      atlas,
      [Share(alice, bps)],
      units,
    )
  }
}
