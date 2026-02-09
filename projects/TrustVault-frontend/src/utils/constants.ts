export const APPROVAL_TEAL = `#pragma version 8
txn NumAppArgs
int 0
==
bnz main_l10
txna ApplicationArgs 0
method "bootstrap(address,uint64)void"
==
bnz main_l9
txna ApplicationArgs 0
method "deposit()void"
==
bnz main_l8
txna ApplicationArgs 0
method "heartbeat()void"
==
bnz main_l7
txna ApplicationArgs 0
method "auto_release()void"
==
bnz main_l6
err
main_l6:
txn OnCompletion
int NoOp
==
txn ApplicationID
int 0
!=
&&
assert
callsub autoreleasecaster_7
int 1
return
main_l7:
txn OnCompletion
int NoOp
==
txn ApplicationID
int 0
!=
&&
assert
callsub heartbeatcaster_6
int 1
return
main_l8:
txn OnCompletion
int NoOp
==
txn ApplicationID
int 0
!=
&&
assert
callsub depositcaster_5
int 1
return
main_l9:
txn OnCompletion
int NoOp
==
txn ApplicationID
int 0
!=
&&
assert
callsub bootstrapcaster_4
int 1
return
main_l10:
txn OnCompletion
int NoOp
==
bnz main_l20
txn OnCompletion
int OptIn
==
bnz main_l19
txn OnCompletion
int CloseOut
==
bnz main_l18
txn OnCompletion
int UpdateApplication
==
bnz main_l17
txn OnCompletion
int DeleteApplication
==
bnz main_l16
err
main_l16:
int 0
return
main_l17:
int 0
return
main_l18:
int 0
return
main_l19:
int 0
return
main_l20:
txn ApplicationID
int 0
==
assert
int 1
return

// bootstrap
bootstrap_0:
proto 2 0
byte "Owner"
app_global_get
int 0
==
assert
byte "Owner"
txn Sender
app_global_put
byte "Beneficiary"
frame_dig -2
app_global_put
byte "LockDuration"
frame_dig -1
app_global_put
byte "LastHeartbeat"
global LatestTimestamp
app_global_put
byte "Released"
int 0
app_global_put
retsub

// deposit
deposit_1:
proto 0 0
byte "Deposit"
log
int 1
return

// heartbeat
heartbeat_2:
proto 0 0
txn Sender
byte "Owner"
app_global_get
==
assert
byte "Released"
app_global_get
int 0
==
assert
global LatestTimestamp
byte "LastHeartbeat"
app_global_get
byte "LockDuration"
app_global_get
+
<
assert
byte "LastHeartbeat"
global LatestTimestamp
app_global_put
byte "Heartbeat"
log
retsub

// auto_release
autorelease_3:
proto 0 0
byte "Released"
app_global_get
int 0
==
assert
global LatestTimestamp
byte "LastHeartbeat"
app_global_get
byte "LockDuration"
app_global_get
+
>=
assert
itxn_begin
int pay
itxn_field TypeEnum
byte "Beneficiary"
app_global_get
itxn_field Receiver
int 0
itxn_field Amount
byte "Beneficiary"
app_global_get
itxn_field CloseRemainderTo
itxn_submit
byte "Released"
int 1
app_global_put
byte "AutoRelease"
log
retsub

// bootstrap_caster
bootstrapcaster_4:
proto 0 0
byte ""
int 0
txna ApplicationArgs 1
frame_bury 0
txna ApplicationArgs 2
btoi
frame_bury 1
frame_dig 0
frame_dig 1
callsub bootstrap_0
retsub

// deposit_caster
depositcaster_5:
proto 0 0
callsub deposit_1
retsub

// heartbeat_caster
heartbeatcaster_6:
proto 0 0
callsub heartbeat_2
retsub

// auto_release_caster
autoreleasecaster_7:
proto 0 0
callsub autorelease_3
retsub
`

export const CLEAR_TEAL = `#pragma version 8
int 0
return
`
