use agentfund/round.{Action, Terms}
use aiken/collection/list
use cardano/address.{Script}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}

validator funding_round(terms: Terms, seed: OutputReference) {
  mint(_redeemer: Data, own: PolicyId, tx: Transaction) {
    round.initial(terms, seed, own, tx)
  }
  spend(_datum: Option<Data>, action: Action, own_ref: OutputReference, tx: Transaction) {
    expect Some(input) = list.find(tx.inputs, fn(i) { i.output_reference == own_ref })
    expect Script(own) = input.output.address.payment_credential
    expect Some(first) = list.find(tx.inputs, fn(i) { i.output.address.payment_credential == Script(own) })
    if first.output_reference == own_ref { round.transition(terms, own, action, tx) } else { True }
  }
  else(_) { fail }
}
