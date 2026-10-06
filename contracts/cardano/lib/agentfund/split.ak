use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/address.{Credential, VerificationKey}
use cardano/assets.{AssetName, PolicyId}
use cardano/transaction.{Input, Output}

/// One investor's cut of every listed asset, in basis points (1/100 of a percent).
pub type Share {
  beneficiary: VerificationKeyHash,
  bps: Int,
}

/// A native asset the splitter divides. Assets not listed (and ADA) pass through unconstrained.
pub type Unit {
  policy: PolicyId,
  name: AssetName,
}

pub const max_bps = 10000

/// Shares are valid when every cut is positive and they add up to at most 100%.
/// Off-chain code must check this before deploying: an invalid set makes the script unspendable.
pub fn shares_are_valid(shares: List<Share>) -> Bool {
  let total = list.foldl(shares, 0, fn(s, acc) { acc + s.bps })
  list.all(shares, fn(s) { s.bps > 0 }) && total <= max_bps
}

/// Quantity of `unit` locked in every input at `own`, so N script inputs are paid out once, together.
pub fn locked(inputs: List<Input>, own: Credential, unit: Unit) -> Int {
  list.foldl(
    inputs,
    0,
    fn(input, acc) {
      if input.output.address.payment_credential == own {
        acc + assets.quantity_of(input.output.value, unit.policy, unit.name)
      } else {
        acc
      }
    },
  )
}

/// Quantity of `unit` paid to outputs whose payment credential is `key`, summed across outputs.
pub fn received(outputs: List<Output>, key: VerificationKeyHash, unit: Unit) -> Int {
  let credential = VerificationKey(key)
  list.foldl(
    outputs,
    0,
    fn(output, acc) {
      if output.address.payment_credential == credential {
        acc + assets.quantity_of(output.value, unit.policy, unit.name)
      } else {
        acc
      }
    },
  )
}

/// Each investor gets at least floor(total * bps / 10000); Atlas gets at least the rest,
/// so rounding dust goes to Atlas and nothing is left unallocated.
pub fn unit_is_split(
  inputs: List<Input>,
  outputs: List<Output>,
  own: Credential,
  atlas: VerificationKeyHash,
  shares: List<Share>,
  unit: Unit,
) -> Bool {
  let total = locked(inputs, own, unit)
  if total == 0 {
    True
  } else {
    let (investors_paid, investor_total) =
      list.foldl(
        shares,
        (True, 0),
        fn(share, acc) {
          let (ok, owed_so_far) = acc
          let owed = total * share.bps / max_bps
          (ok && received(outputs, share.beneficiary, unit) >= owed, owed_so_far + owed)
        },
      )
    investors_paid && received(outputs, atlas, unit) >= total - investor_total
  }
}

pub fn is_split(
  inputs: List<Input>,
  outputs: List<Output>,
  own: Credential,
  atlas: VerificationKeyHash,
  shares: List<Share>,
  units: List<Unit>,
) -> Bool {
  shares_are_valid(shares) && list.all(
    units,
    fn(unit) { unit_is_split(inputs, outputs, own, atlas, shares, unit) },
  )
}
