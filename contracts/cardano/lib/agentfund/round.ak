use aiken/collection/dict
use aiken/collection/list
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{InlineDatum, Output, OutputReference, Transaction}

pub type Terms {
  operator: Address,
  policy: ByteArray,
  name: ByteArray,
  capital: Int,
  bps: Int,
  cap: Int,
}
pub type State {
  Offered
  Active { investor: Address, earned: Int, paid: Int }
  Closed { investor: Address, earned: Int, paid: Int }
  Cancelled
}
pub type Action {
  Fund { investor: Address }
  Distribute
  Cancel
}
pub const marker = #"526f756e64"

pub fn valid_terms(t: Terms) -> Bool {
  expect VerificationKey(_) = t.operator.payment_credential
  t.policy != #"" && t.capital > 0 && t.bps > 0 && t.bps <= 10000 && t.cap > 0
}
pub fn signed(tx: Transaction, who: Address) -> Bool {
  expect VerificationKey(key) = who.payment_credential
  list.has(tx.extra_signatories, key)
}
pub fn amount_outputs(outputs: List<Output>, address: Address, t: Terms) -> Int {
  list.foldl(outputs, 0, fn(o, n) {
    if o.address == address { n + assets.quantity_of(o.value, t.policy, t.name) } else { n }
  })
}
pub fn net(tx: Transaction, address: Address, t: Terms) -> Int {
  amount_outputs(tx.outputs, address, t) - amount_outputs(list.map(tx.inputs, fn(i) { i.output }), address, t)
}
pub fn clean_state(o: Output, own: ByteArray) -> Bool {
  assets.without_lovelace(o.value) == assets.from_asset(own, marker, 1)
}
pub fn state_of(o: Output) -> State {
  expect InlineDatum(d) = o.datum
  expect s: State = d
  s
}
pub fn initial(t: Terms, seed: OutputReference, own: ByteArray, tx: Transaction) -> Bool {
  expect [Pair(name, quantity)] = assets.tokens(tx.mint, own) |> dict.to_pairs()
  expect [out] = list.filter(tx.outputs, fn(o) { assets.quantity_of(o.value, own, marker) != 0 })
  and {
    valid_terms(t), t.policy != own, name == marker, quantity == 1,
    list.any(tx.inputs, fn(i) { i.output_reference == seed }), signed(tx, t.operator),
    out.address == Address(Script(own), None), clean_state(out, own), state_of(out) == Offered,
  }
}

pub fn transition(t: Terms, own: ByteArray, action: Action, tx: Transaction) -> Bool {
  let address = Address(Script(own), None)
  // Only one round may spend in a transaction: payouts cannot satisfy two rounds.
  expect list.all(tx.inputs, fn(i) {
    when i.output.address.payment_credential is {
      Script(h) -> h == own && i.output.address == address
      VerificationKey(_) -> True
    }
  })
  expect [state_input] = list.filter(tx.inputs, fn(i) { assets.quantity_of(i.output.value, own, marker) != 0 })
  expect [next] = list.filter(tx.outputs, fn(o) { assets.quantity_of(o.value, own, marker) != 0 })
  expect state_input.output.address == address && next.address == address
  expect clean_state(state_input.output, own) && clean_state(next, own)
  expect assets.lovelace_of(next.value) >= assets.lovelace_of(state_input.output.value)
  expect assets.tokens(tx.mint, own) |> dict.is_empty
  expect assets.quantity_of(tx.mint, t.policy, t.name) == 0
  let before = state_of(state_input.output)
  let after = state_of(next)
  let receipts = list.filter(tx.inputs, fn(i) { i.output.address == address && i.output_reference != state_input.output_reference })
  let revenue = list.foldl(receipts, 0, fn(i, n) { n + assets.quantity_of(i.output.value, t.policy, t.name) })
  expect list.all(receipts, fn(i) {
    assets.without_lovelace(i.output.value) == assets.from_asset(t.policy, t.name, assets.quantity_of(i.output.value, t.policy, t.name))
  })
  when action is {
    Fund { investor } -> and {
      before == Offered, after == Active { investor, earned: 0, paid: 0 },
      investor != t.operator, signed(tx, investor), list.is_empty(receipts),
      net(tx, investor, t) <= -t.capital, net(tx, t.operator, t) == t.capital,
    }
    Cancel -> and { before == Offered, after == Cancelled, signed(tx, t.operator), list.is_empty(receipts) }
    Distribute -> {
      expect revenue > 0
      when before is {
        Active { investor, earned, paid } -> {
          expect earned >= 0 && paid == earned * t.bps / 10000 && paid < t.cap
          let total = earned + revenue
          let uncapped = total * t.bps / 10000
          let due = if uncapped < t.cap { uncapped } else { t.cap }
          let payout = due - paid
          and {
            after == if due == t.cap { Closed { investor, earned: total, paid: due } } else { Active { investor, earned: total, paid: due } },
            net(tx, investor, t) == payout, net(tx, t.operator, t) == revenue - payout,
          }
        }
        Closed { investor, earned, paid } -> and {
          paid == t.cap, after == Closed { investor, earned: earned + revenue, paid },
          net(tx, investor, t) == 0, net(tx, t.operator, t) == revenue,
        }
        Cancelled -> after == Cancelled && net(tx, t.operator, t) == revenue
        Offered -> False
      }
    }
  }
}
