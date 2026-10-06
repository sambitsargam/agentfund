use agentfund/round.{Active, Cancel, Cancelled, Closed, Distribute, Fund, Offered, State, Terms}
use agentfund/split_test.{alice, atlas, bob, own_hash, usdm_x402}
use cardano/address.{Address, Script, VerificationKey}
use cardano/assets
use cardano/transaction.{InlineDatum, Input, NoDatum, Output, OutputReference, Transaction}

const operator = Address(VerificationKey(atlas), None)
const investor = Address(VerificationKey(alice), None)
const terms = Terms { operator, policy: usdm_x402.policy, name: usdm_x402.name, capital: 100, bps: 2000, cap: 120 }
const own = Address(Script(own_hash), None)
fn ref(n: Int) -> OutputReference { OutputReference { transaction_id: #"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", output_index: n } }
fn out(address: Address, quantity: Int) -> Output {
  Output { address, value: assets.from_lovelace(5000000) |> assets.add(terms.policy, terms.name, quantity), datum: NoDatum, reference_script: None }
}
fn state(s: State) -> Output {
  Output { ..out(own, 0), value: assets.from_lovelace(5000000) |> assets.add(own_hash, round.marker, 1), datum: InlineDatum(s) }
}
fn input(n: Int, o: Output) -> Input { Input { output_reference: ref(n), output: o } }
fn funding() -> Transaction {
  Transaction { ..transaction.placeholder, inputs: [input(0, state(Offered)), input(1, out(investor, 100))], outputs: [state(Active { investor, earned: 0, paid: 0 }), out(operator, 100)], extra_signatories: [alice] }
}
fn distribution(before: State, after: State, revenue: Int, payout: Int) -> Transaction {
  Transaction { ..transaction.placeholder, inputs: [input(0, state(before)), input(1, out(own, revenue))], outputs: [state(after), out(investor, payout), out(operator, revenue-payout)] }
}
fn first_payout() -> Transaction { distribution(Active { investor, earned: 0, paid: 0 }, Active { investor, earned: 250, paid: 50 }, 250, 50) }
fn genesis() -> Transaction {
  Transaction { ..transaction.placeholder, inputs: [input(9, out(operator, 0))], outputs: [state(Offered)], mint: assets.from_asset(own_hash, round.marker, 1), extra_signatories: [atlas] }
}
test valid_genesis() { round.initial(terms, ref(9), own_hash, genesis()) }
test wrong_seed() { !round.initial(terms, ref(8), own_hash, genesis()) }
test no_operator_signature() { !round.initial(terms, ref(9), own_hash, Transaction { ..genesis(), extra_signatories: [] }) }
test forged_active_genesis() { !round.initial(terms, ref(9), own_hash, Transaction { ..genesis(), outputs: [state(Active { investor, earned: 0, paid: 0 })] }) }
test invalid_share() { !round.initial(Terms { ..terms, bps: 10001 }, ref(9), own_hash, genesis()) }
test extra_marker_name() fail { round.initial(terms, ref(9), own_hash, Transaction { ..genesis(), mint: assets.from_asset(own_hash, round.marker, 1) |> assets.add(own_hash, #"aa", 1) }) }
test funds_and_activates() { round.transition(terms, own_hash, Fund { investor }, funding()) }
test activation_without_capital() { !round.transition(terms, own_hash, Fund { investor }, Transaction { ..funding(), outputs: [state(Active { investor, earned: 0, paid: 0 })] }) }
test investor_must_sign() { !round.transition(terms, own_hash, Fund { investor }, Transaction { ..funding(), extra_signatories: [] }) }
test cannot_fund_twice() { !round.transition(terms, own_hash, Fund { investor }, Transaction { ..funding(), inputs: [input(0, state(Active { investor, earned: 0, paid: 0 })), input(1, out(investor, 100))] }) }
test cannot_change_investor() { !round.transition(terms, own_hash, Fund { investor }, Transaction { ..funding(), outputs: [state(Active { investor: Address(VerificationKey(bob), None), earned: 0, paid: 0 }), out(operator, 100)] }) }
test state_nft_required() fail { round.transition(terms, own_hash, Distribute, Transaction { ..first_payout(), inputs: [input(1, out(own, 250))] }) }
test first_payout_correct() { round.transition(terms, own_hash, Distribute, first_payout()) }
test short_payment() { !round.transition(terms, own_hash, Distribute, Transaction { ..first_payout(), outputs: [state(Active { investor, earned: 250, paid: 50 }), out(investor, 49), out(operator, 201)] }) }
test investor_change_is_not_payout() { !round.transition(terms, own_hash, Distribute, Transaction { ..first_payout(), inputs: [input(0, state(Active { investor, earned: 0, paid: 0 })), input(1, out(own, 250)), input(2, out(investor, 50))] }) }
test cap_closes_round() { round.transition(terms, own_hash, Distribute, distribution(Active { investor, earned: 250, paid: 50 }, Closed { investor, earned: 750, paid: 120 }, 500, 70)) }
test closed_round_pays_only_operator() { round.transition(terms, own_hash, Distribute, distribution(Closed { investor, earned: 750, paid: 120 }, Closed { investor, earned: 1000, paid: 120 }, 250, 0)) }
test cannot_pay_beyond_cap() { !round.transition(terms, own_hash, Distribute, distribution(Closed { investor, earned: 750, paid: 120 }, Closed { investor, earned: 1000, paid: 170 }, 250, 50)) }
test cannot_reset_earned() { !round.transition(terms, own_hash, Distribute, distribution(Active { investor, earned: 250, paid: 50 }, Active { investor, earned: 250, paid: 50 }, 250, 0)) }
test rounding_carries_between_batches() { round.transition(terms, own_hash, Distribute, distribution(Active { investor, earned: 4, paid: 0 }, Active { investor, earned: 5, paid: 1 }, 1, 1)) }
test no_payout_before_funding() { !round.transition(terms, own_hash, Distribute, distribution(Offered, Closed { investor, earned: 750, paid: 120 }, 750, 120)) }
test cannot_steal_locked_ada() fail { round.transition(terms, own_hash, Distribute, Transaction { ..first_payout(), outputs: [Output { ..state(Active { investor, earned: 250, paid: 50 }), value: assets.from_lovelace(2000000) |> assets.add(own_hash, round.marker, 1) }, out(investor, 50), out(operator, 200)] }) }
test other_script_cannot_reuse_payout() fail { round.transition(terms, own_hash, Distribute, Transaction { ..first_payout(), inputs: [input(0, state(Active { investor, earned: 0, paid: 0 })), input(1, out(own, 250)), input(2, out(Address(Script(#"bb"), None), 250))] }) }
test cancel_only_before_funding() {
  round.transition(terms, own_hash, Cancel, Transaction { ..transaction.placeholder, inputs: [input(0, state(Offered))], outputs: [state(Cancelled)], extra_signatories: [atlas] })
}
test cannot_cancel_active() { !round.transition(terms, own_hash, Cancel, Transaction { ..first_payout(), outputs: [state(Cancelled)], extra_signatories: [atlas] }) }
test no_marker_mint_during_spend() fail { round.transition(terms, own_hash, Distribute, Transaction { ..first_payout(), mint: assets.from_asset(own_hash, round.marker, -1) }) }
