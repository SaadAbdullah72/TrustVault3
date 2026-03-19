import os
from pyteal import *

# ⚠️ SECURITY WARNING: Never store mnemonic / seed phrases in source code.
# Use environment variables or a secure secrets manager instead.
# Example: DEPLOYER_MNEMONIC = os.environ.get("DEPLOYER_MNEMONIC")

# Global States
owner_key = Bytes("Owner")
beneficiary_key = Bytes("Beneficiary")
lock_duration_key = Bytes("LockDuration")
last_heartbeat_key = Bytes("LastHeartbeat")
released_key = Bytes("Released")

router = Router(
    "AutoInheritanceVault",
    BareCallActions(
        no_op=OnCompleteAction.create_only(Approve()),
        opt_in=OnCompleteAction.always(Reject()),
        close_out=OnCompleteAction.always(Reject()),
        update_application=OnCompleteAction.always(Reject()),
        delete_application=OnCompleteAction.always(Reject()),
    ),
)


@router.method
def bootstrap(beneficiary: abi.Address, lock_duration: abi.Uint64):
    return Seq(
        # Allow bootstrap only if Owner is not set yet
        Assert(App.globalGet(owner_key) == Int(0)),
        
        App.globalPut(owner_key, Txn.sender()),
        App.globalPut(beneficiary_key, beneficiary.get()),
        App.globalPut(lock_duration_key, lock_duration.get()),
        App.globalPut(last_heartbeat_key, Global.latest_timestamp()),
        App.globalPut(released_key, Int(0)),
    )


@router.method
def deposit():
    return Seq(
        # Just logging the deposit event
        Log(Bytes("Deposit")),
        Approve()
    )


@router.method
def heartbeat():
    # Only owner can call this to reset the timer
    return Seq(
        Assert(Txn.sender() == App.globalGet(owner_key)),
        Assert(App.globalGet(released_key) == Int(0)),
        # check: timer should not have expired
        Assert(Global.latest_timestamp() < App.globalGet(last_heartbeat_key) + App.globalGet(lock_duration_key)),
        App.globalPut(last_heartbeat_key, Global.latest_timestamp()),
        Log(Bytes("Heartbeat")),
    )


@router.method
def withdraw(amount: abi.Uint64):
    return Seq(
        # Only owner can withdraw
        Assert(Txn.sender() == App.globalGet(owner_key)),
        
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: Txn.sender(),
            TxnField.amount: amount.get(), 
        }),
        InnerTxnBuilder.Submit(),
        
        Log(Bytes("Withdraw")),
    )


@router.method
def auto_release():
    # Logic:
    # 1. Check if already released
    # 2. Check if lock duration has passed
    # 3. Transfer all funds to beneficiary
    # 4. Mark as released
    # 5. Emit event
    
    last_heartbeat = App.globalGet(last_heartbeat_key)
    lock_duration = App.globalGet(lock_duration_key)
    beneficiary = App.globalGet(beneficiary_key)
    
    return Seq(
        Assert(App.globalGet(released_key) == Int(0)),
        Assert(Global.latest_timestamp() >= last_heartbeat + lock_duration),
        
        # Send all funds to beneficiary
        InnerTxnBuilder.Begin(),
        InnerTxnBuilder.SetFields({
            TxnField.type_enum: TxnType.Payment,
            TxnField.receiver: beneficiary,
            TxnField.amount: Int(0), # Send 0 means we rely on close_remainder_to
            TxnField.close_remainder_to: beneficiary,
        }),
        InnerTxnBuilder.Submit(),
        
        App.globalPut(released_key, Int(1)),
        Log(Bytes("AutoRelease")),
    )


if __name__ == "__main__":
    approval, clear, contract = router.compile_program(version=8)
    
    # Ensure directory exists
    os.makedirs("artifacts", exist_ok=True)
    
    with open("artifacts/approval.teal", "w") as f:
        f.write(approval)
        
    with open("artifacts/clear.teal", "w") as f:
        f.write(clear)
        
    with open("artifacts/contract.json", "w") as f:
        import json
        f.write(json.dumps(contract.dictify(), indent=4))
