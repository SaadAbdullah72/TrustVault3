import json
import base64
import os
from pathlib import Path
from algosdk import mnemonic, account, transaction
from algosdk.v2client import algod
from algosdk.abi import Method
from algosdk.atomic_transaction_composer import AtomicTransactionComposer, AccountTransactionSigner, TransactionWithSigner
from dotenv import load_dotenv

# Load .env file from the TrustVault-contracts directory
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

def deploy():
    print("=" * 60)
    print("Starting Auto Inheritance Vault Deployment to Testnet")
    print("=" * 60)
    
    # Get mnemonic from environment
    mnemonic_phrase = os.getenv("DEPLOYER_MNEMONIC")
    if not mnemonic_phrase:
        raise ValueError("DEPLOYER_MNEMONIC not found in environment!")
    
    # Remove quotes if present
    mnemonic_phrase = mnemonic_phrase.strip('"').strip("'")
    
    # Get private key and address from mnemonic
    private_key = mnemonic.to_private_key(mnemonic_phrase)
    deployer_address = account.address_from_private_key(private_key)
    
    print(f"Deploying with account: {deployer_address}")
    
    # Initialize Algod Client
    algod_server = os.getenv("ALGOD_SERVER", "https://testnet-api.algonode.cloud")
    algod_port = os.getenv("ALGOD_PORT", "443")
    algod_token = os.getenv("ALGOD_TOKEN", "")
    
    algod_address = f"{algod_server}:{algod_port}" if algod_port else algod_server
    algod_client = algod.AlgodClient(algod_token, algod_address)
    
    # Check account balance
    account_info = algod_client.account_info(deployer_address)
    balance = account_info.get("amount", 0)
    print(f"Account balance: {balance / 1_000_000:.6f} Algos")
    
    if balance < 1_000_000:
        raise ValueError(f"Insufficient balance! Need at least 1 Algo. Current: {balance / 1_000_000:.6f} Algos")
    
    # Load artifacts
    artifacts_path = Path(__file__).parent.parent.parent / "artifacts"
    approval_path = artifacts_path / "approval.teal"
    clear_path = artifacts_path / "clear.teal"
    contract_path = artifacts_path / "contract.json"
    
    with open(approval_path) as f:
        approval_source = f.read()
        
    with open(clear_path) as f:
        clear_source = f.read()
        
    with open(contract_path) as f:
        contract_dict = json.load(f)
    
    # Compile TEAL programs
    print("Compiling TEAL programs...")
    approval_result = algod_client.compile(approval_source)
    approval_program = base64.b64decode(approval_result["result"])
    
    clear_result = algod_client.compile(clear_source)
    clear_program = base64.b64decode(clear_result["result"])
    
    # Get suggested params
    sp = algod_client.suggested_params()
    
    # Create the application
    print("Creating application...")
    
    global_schema = transaction.StateSchema(num_uints=4, num_byte_slices=4)
    local_schema = transaction.StateSchema(num_uints=0, num_byte_slices=0)
    
    txn = transaction.ApplicationCreateTxn(
        sender=deployer_address,
        sp=sp,
        on_complete=transaction.OnComplete.NoOpOC,
        approval_program=approval_program,
        clear_program=clear_program,
        global_schema=global_schema,
        local_schema=local_schema
    )
    
    signed_txn = txn.sign(private_key)
    tx_id = algod_client.send_transaction(signed_txn)
    print(f"Transaction ID: {tx_id}")
    
    # Wait for confirmation
    result = transaction.wait_for_confirmation(algod_client, tx_id, 4)
    app_id = result["application-index"]
    app_address = transaction.logic.get_application_address(app_id)
    
    print(f"\n*** DEPLOYED APP ID: {app_id} ***")
    print(f"*** APP ADDRESS: {app_address} ***\n")
    
    # Save App ID to file
    with open(Path(__file__).parent.parent.parent / "app_details.json", "w") as f:
        json.dump({"app_id": app_id, "app_address": app_address, "deployer": deployer_address}, f, indent=2)
    
    # Bootstrap the contract with ABI method call
    # print("Bootstrapping contract...")
    
    # Find bootstrap method
    # bootstrap_method_def = None
    # for m in contract_dict["methods"]:
    #     if m["name"] == "bootstrap":
    #         bootstrap_method_def = m
    #         break
    
    # if not bootstrap_method_def:
    #     raise ValueError("bootstrap method not found in contract!")
    
    # bootstrap_method = Method.from_signature(Method.from_json(json.dumps(bootstrap_method_def)).get_signature())
    
    # signer = AccountTransactionSigner(private_key)
    # sp = algod_client.suggested_params()
    
    # atc = AtomicTransactionComposer()
    # atc.add_method_call(
    #     app_id=app_id,
    #     method=bootstrap_method,
    #     sender=deployer_address,
    #     sp=sp,
    #     signer=signer,
    #     method_args=[deployer_address, 60]  # beneficiary, lock_duration
    # )
    
    # result = atc.execute(algod_client, 4)
    # print(f"Bootstrap TX: {result.tx_ids[0]}")
    
    # Fund the contract
    print("Funding contract with 2 Algos...")
    sp = algod_client.suggested_params()
    
    fund_txn = transaction.PaymentTxn(
        sender=deployer_address,
        sp=sp,
        receiver=app_address,
        amt=2_000_000  # 2 Algos in microAlgos
    )
    
    signed_fund = fund_txn.sign(private_key)
    fund_tx_id = algod_client.send_transaction(signed_fund)
    transaction.wait_for_confirmation(algod_client, fund_tx_id, 4)
    print(f"Funding TX: {fund_tx_id}")
    
    # Call deposit method
    # print("Calling deposit method...")
    # deposit_method_def = None
    # for m in contract_dict["methods"]:
    #     if m["name"] == "deposit":
    #         deposit_method_def = m
    #         break
    
    # if deposit_method_def:
    #     deposit_method = Method.from_signature(Method.from_json(json.dumps(deposit_method_def)).get_signature())
        
    #     sp = algod_client.suggested_params()
    #     atc2 = AtomicTransactionComposer()
    #     atc2.add_method_call(
    #         app_id=app_id,
    #         method=deposit_method,
    #         sender=deployer_address,
    #         sp=sp,
    #         signer=signer,
    #         method_args=[]
    #     )
        
    #     result2 = atc2.execute(algod_client, 4)
    #     print(f"Deposit TX: {result2.tx_ids[0]}")
    
    print("\n" + "=" * 60)
    print("DEPLOYMENT COMPLETE!")
    print("=" * 60)
    print(f"App ID: {app_id}")
    print(f"App Address: {app_address}")
    print(f"Deployer: {deployer_address}")
    print("=" * 60)

if __name__ == "__main__":
    deploy()
