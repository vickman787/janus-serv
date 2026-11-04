module janus_handover::handover;

use std::string::String;
use sui::clock::{Self, Clock};
use sui::event;

const E_ADMIN: u64 = 0;
const E_SUCCESSOR: u64 = 1;
const E_REVISION: u64 = 2;
const E_EXPIRED: u64 = 3;
const E_STAGE: u64 = 4;
const E_CONTROL: u64 = 5;
const E_SELF: u64 = 6;
const E_EXPIRY: u64 = 7;

public struct Control has key {
    id: UID,
    administrator: address,
    revision: u64,
    pending_proposal: ID,
    counter: u64,
}
public struct Proposal has key {
    id: UID,
    control: ID,
    operation_id: String,
    administrator: address,
    successor: address,
    revision: u64,
    expires_at_ms: u64,
    stage: u8,
}
public struct ControlCreated has copy, drop { control: ID, administrator: address }
public struct Transition has copy, drop {
    control: ID, proposal: ID, operation_id: String, revision: u64,
    administrator: address, successor: address, expires_at_ms: u64, stage: u8,
}

public fun create(ctx: &mut TxContext) {
    let control = Control { id: object::new(ctx), administrator: ctx.sender(), revision: 0, pending_proposal: @0x0.to_id(), counter: 0 };
    event::emit(ControlCreated { control: object::id(&control), administrator: ctx.sender() });
    transfer::share_object(control);
}
public fun increment(control: &mut Control, ctx: &TxContext) {
    assert!(control.administrator == ctx.sender(), E_ADMIN);
    control.counter = control.counter + 1;
}
public fun propose(control: &mut Control, operation_id: String, successor: address, expires_at_ms: u64, expected_revision: u64, clock: &Clock, ctx: &mut TxContext) {
    assert!(control.administrator == ctx.sender(), E_ADMIN);
    assert!(control.revision == expected_revision, E_REVISION);
    assert!(control.pending_proposal == @0x0.to_id(), E_STAGE);
    assert!(successor != ctx.sender() && successor != @0x0, E_SELF);
    assert!(expires_at_ms > clock.timestamp_ms() && expires_at_ms - clock.timestamp_ms() <= 2592000000, E_EXPIRY);
    control.revision = control.revision + 1;
    let proposal = Proposal { id: object::new(ctx), control: object::id(control), operation_id,
        administrator: ctx.sender(), successor, revision: control.revision, expires_at_ms, stage: 1 };
    control.pending_proposal = object::id(&proposal);
    emit(&proposal);
    transfer::share_object(proposal);
}
fun validate(control: &Control, proposal: &Proposal, revision: u64) {
    assert!(proposal.control == object::id(control) && control.pending_proposal == object::id(proposal), E_CONTROL);
    assert!(proposal.revision == revision && control.revision == revision, E_REVISION);
    assert!(proposal.stage == 1, E_STAGE);
}
public fun accept(control: &mut Control, proposal: &mut Proposal, revision: u64, clock: &Clock, ctx: &TxContext) {
    validate(control, proposal, revision);
    assert!(ctx.sender() == proposal.successor, E_SUCCESSOR);
    assert!(clock.timestamp_ms() < proposal.expires_at_ms, E_EXPIRED);
    assert!(control.administrator == proposal.administrator, E_ADMIN);
    control.administrator = proposal.successor;
    control.pending_proposal = @0x0.to_id();
    proposal.stage = 2;
    emit(proposal);
}
public fun cancel(control: &mut Control, proposal: &mut Proposal, revision: u64, clock: &Clock, ctx: &TxContext) {
    validate(control, proposal, revision);
    assert!(ctx.sender() == control.administrator, E_ADMIN);
    assert!(clock.timestamp_ms() < proposal.expires_at_ms, E_EXPIRED);
    control.pending_proposal = @0x0.to_id();
    proposal.stage = 3;
    emit(proposal);
}
public fun expire(control: &mut Control, proposal: &mut Proposal, revision: u64, clock: &Clock) {
    validate(control, proposal, revision);
    assert!(clock.timestamp_ms() >= proposal.expires_at_ms, E_EXPIRY);
    control.pending_proposal = @0x0.to_id();
    proposal.stage = 4;
    emit(proposal);
}
public fun change_successor(control: &mut Control, proposal: &mut Proposal, revision: u64, successor: address, clock: &Clock, ctx: &TxContext) {
    validate(control, proposal, revision);
    assert!(ctx.sender() == control.administrator, E_ADMIN);
    assert!(clock.timestamp_ms() < proposal.expires_at_ms, E_EXPIRED);
    assert!(successor != control.administrator && successor != @0x0, E_SELF);
    control.revision = control.revision + 1;
    proposal.revision = control.revision;
    proposal.successor = successor;
    emit(proposal);
}
fun emit(proposal: &Proposal) {
    event::emit(Transition { control: proposal.control, proposal: object::id(proposal), operation_id: proposal.operation_id,
        revision: proposal.revision, administrator: proposal.administrator, successor: proposal.successor,
        expires_at_ms: proposal.expires_at_ms, stage: proposal.stage });
}

#[test_only]
fun fixture(admin: address, successor: address, ctx: &mut TxContext): (Control, Proposal, Clock) {
    let control = Control { id: object::new(ctx), administrator: admin, revision: 1, pending_proposal: @0x0.to_id(), counter: 0 };
    let proposal = Proposal { id: object::new(ctx), control: object::id(&control), operation_id: b"test-op".to_string(), administrator: admin,
        successor, revision: 1, expires_at_ms: 1000, stage: 1 };
    let mut control = control;
    control.pending_proposal = object::id(&proposal);
    (control, proposal, clock::create_for_testing(ctx))
}
#[test_only]
fun cleanup(control: Control, proposal: Proposal, clock: Clock) {
    let Control { id, administrator: _, revision: _, pending_proposal: _, counter: _ } = control; id.delete();
    let Proposal { id, control: _, operation_id: _, administrator: _, successor: _, revision: _, expires_at_ms: _, stage: _ } = proposal; id.delete();
    clock.destroy_for_testing();
}
#[test]
fun acceptance_changes_real_authority() {
    let mut ctx = tx_context::dummy();
    let (mut c, mut p, clock) = fixture(@0xA, @0x0, &mut ctx);
    accept(&mut c, &mut p, 1, &clock, &ctx);
    increment(&mut c, &ctx);
    assert!(c.counter == 1 && c.administrator == @0x0 && p.stage == 2);
    cleanup(c, p, clock);
}
#[test, expected_failure(abort_code = E_SUCCESSOR)]
fun wrong_successor() { let mut ctx = tx_context::dummy(); let (mut c, mut p, t) = fixture(@0xA, @0xB, &mut ctx); accept(&mut c, &mut p, 1, &t, &ctx); cleanup(c,p,t); }
#[test, expected_failure(abort_code = E_REVISION)]
fun stale_revision() { let mut ctx = tx_context::dummy(); let (mut c, mut p, t) = fixture(@0xA, @0x0, &mut ctx); accept(&mut c, &mut p, 0, &t, &ctx); cleanup(c,p,t); }
#[test, expected_failure(abort_code = E_EXPIRED)]
fun expired_acceptance() { let mut ctx = tx_context::dummy(); let (mut c, mut p, mut t) = fixture(@0xA, @0x0, &mut ctx); t.increment_for_testing(1000); accept(&mut c, &mut p, 1, &t, &ctx); cleanup(c,p,t); }
#[test, expected_failure(abort_code = E_CONTROL)]
fun repeat_acceptance() { let mut ctx = tx_context::dummy(); let (mut c, mut p, t) = fixture(@0xA, @0x0, &mut ctx); accept(&mut c, &mut p, 1, &t, &ctx); accept(&mut c, &mut p, 1, &t, &ctx); cleanup(c,p,t); }
#[test, expected_failure(abort_code = E_ADMIN)]
fun wrong_cancel_actor() { let mut ctx = tx_context::dummy(); let (mut c, mut p, t) = fixture(@0xA, @0x0, &mut ctx); cancel(&mut c, &mut p, 1, &t, &ctx); cleanup(c,p,t); }
#[test]
fun cancel_and_change_revision() {
    let mut ctx = tx_context::dummy(); let (mut c, mut p, t) = fixture(@0x0, @0xB, &mut ctx);
    change_successor(&mut c, &mut p, 1, @0xC, &t, &ctx); assert!(p.revision == 2 && p.successor == @0xC);
    cancel(&mut c, &mut p, 2, &t, &ctx); assert!(p.stage == 3); cleanup(c,p,t);
}
#[test, expected_failure(abort_code = E_ADMIN)]
fun authority_gates_action() { let mut ctx = tx_context::dummy(); let (mut c,p,t) = fixture(@0xA, @0xB, &mut ctx); increment(&mut c, &ctx); cleanup(c,p,t); }
#[test, expected_failure(abort_code = E_CONTROL)]
fun wrong_application() { let mut ctx = tx_context::dummy(); let (mut c,mut p,t) = fixture(@0xA, @0x0, &mut ctx); p.control = @0xF.to_id(); accept(&mut c,&mut p,1,&t,&ctx); cleanup(c,p,t); }
#[test]
fun expiry_unlocks_control() { let mut ctx = tx_context::dummy(); let (mut c,mut p,mut t) = fixture(@0xA,@0xB,&mut ctx); t.increment_for_testing(1000); expire(&mut c,&mut p,1,&t); assert!(p.stage == 4 && c.pending_proposal == @0x0.to_id()); cleanup(c,p,t); }
#[test, expected_failure(abort_code = E_ADMIN)]
fun wrong_proposal_actor() { let mut ctx = tx_context::dummy(); let (mut c,p,t) = fixture(@0xA,@0xB,&mut ctx); c.pending_proposal = @0x0.to_id(); propose(&mut c,b"op".to_string(),@0xB,1000,1,&t,&mut ctx); cleanup(c,p,t); }

#[test]
fun valid_proposal_advances_revision() {
    let mut ctx = tx_context::dummy(); let (mut c,p,t) = fixture(@0x0,@0xB,&mut ctx);
    c.pending_proposal = @0x0.to_id();
    propose(&mut c,b"new-operation".to_string(),@0xC,1000,1,&t,&mut ctx);
    assert!(c.revision == 2 && c.pending_proposal != @0x0.to_id());
    cleanup(c,p,t);
}
#[test, expected_failure(abort_code = E_SELF)]
fun refuses_self_proposal() {
    let mut ctx = tx_context::dummy(); let (mut c,p,t) = fixture(@0x0,@0xB,&mut ctx);
    c.pending_proposal = @0x0.to_id(); propose(&mut c,b"op".to_string(),@0x0,1000,1,&t,&mut ctx); cleanup(c,p,t);
}
#[test, expected_failure(abort_code = E_REVISION)]
fun changed_successor_invalidates_old_revision() {
    let mut ctx = tx_context::dummy(); let (mut c,mut p,t) = fixture(@0x0,@0xB,&mut ctx);
    change_successor(&mut c,&mut p,1,@0xC,&t,&ctx); accept(&mut c,&mut p,1,&t,&ctx); cleanup(c,p,t);
}
#[test, expected_failure(abort_code = E_CONTROL)]
fun cancelled_proposal_cannot_be_accepted() {
    let mut ctx = tx_context::dummy(); let (mut c,mut p,t) = fixture(@0x0,@0xB,&mut ctx);
    cancel(&mut c,&mut p,1,&t,&ctx); accept(&mut c,&mut p,1,&t,&ctx); cleanup(c,p,t);
}
#[test, expected_failure(abort_code = E_EXPIRY)]
fun proposal_requires_future_expiry() {
    let mut ctx = tx_context::dummy(); let (mut c,p,t) = fixture(@0x0,@0xB,&mut ctx);
    c.pending_proposal = @0x0.to_id(); propose(&mut c,b"op".to_string(),@0xB,0,1,&t,&mut ctx); cleanup(c,p,t);
}
