from algosdk import mnemonic, account

# User's seed phrase
seed = "rib couple must write struggle eyebrow spell boring shell blur among seek spoon carbon flame horse cause message ship family silver violin always abstract vote"

private_key = mnemonic.to_private_key(seed)
address = account.address_from_private_key(private_key)

print(f"Address from seed phrase: {address}")
