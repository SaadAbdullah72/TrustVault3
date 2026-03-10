import algosdk from 'algosdk'
import { APPROVAL_TEAL, CLEAR_TEAL } from './constants'

// Testnet Configuration
export const ALGOD_SERVER = 'https://testnet-api.algonode.cloud'
export const ALGOD_PORT = 443
export const ALGOD_TOKEN = ''

export const INDEXER_SERVER = 'https://testnet-idx.algonode.cloud'
export const INDEXER_PORT = 443
export const INDEXER_TOKEN = ''

// Create clients
export const algodClient = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT)
export const indexerClient = new algosdk.Indexer(INDEXER_TOKEN, INDEXER_SERVER, INDEXER_PORT)

// App ID fallback (for testing or initial load)
export const APP_ID = 755263236

// Note prefix for automatic discovery
export const VAULT_NOTE_PREFIX = 'TrustVault:v1:beneficiary:'

// Function to discover vaults where the user is either the creator or beneficiary
export const discoverVaults = async (address: string): Promise<bigint[]> => {
    try {
        const foundIds = new Set<string>()

        // Helper to process transactions
        const processTxs = (txs: any[]) => {
            txs.forEach((tx: any) => {
                const appId = tx['application-transaction']?.['application-id']
                if (appId) foundIds.add(appId.toString())
            })
        }

        // Run both searches in parallel for speed
        const [createdApps, involvedTxs] = await Promise.all([
            indexerClient.searchForApplications().creator(address).do().catch((e: any) => {
                console.warn('Creator search failed:', e)
                return { applications: [] }
            }),
            indexerClient.searchForTransactions().address(address).txType('appl').do().catch((e: any) => {
                console.warn('Involved txs search failed:', e)
                return { transactions: [] }
            })
        ])

        if (createdApps.applications) {
            createdApps.applications.forEach((app: any) => foundIds.add(app.id.toString()))
        }
        processTxs(involvedTxs.transactions || [])

        // Also include locally cached vault IDs
        if (typeof window !== 'undefined') {
            const cached = localStorage.getItem(`trustvault_ids_${address}`)
            if (cached) {
                try {
                    JSON.parse(cached).forEach((id: string) => foundIds.add(id))
                } catch (e) { /* ignore */ }
            }
        }

        console.log(`Discovery for ${address}: Found ${foundIds.size} vault(s)`)
        return Array.from(foundIds).map(id => BigInt(id))
    } catch (error) {
        console.error('Error discovering vaults:', error)
        return []
    }
}

// Type for claimable vault (beneficiary auto-discovery)
export interface ClaimableVault {
    appId: bigint
    state: VaultState
}

// Discover vaults where the user is listed as beneficiary AND timer has expired
// Uses Supabase (primary), note-prefix, localStorage, and Indexer as discovery methods
export const discoverBeneficiaryVaults = async (address: string): Promise<ClaimableVault[]> => {
    try {
        const foundIds = new Set<string>()

        // Run ALL discovery methods in parallel for speed
        const [supabaseIds, noteTxs, involvedTxs] = await Promise.all([
            // Method 0: Supabase cloud registry (PRIMARY — cross-device)
            import('./supabase').then(mod => mod.getVaultsByBeneficiary(address)).catch(() => [] as string[]),

            // Method 1: Note-prefix search (blockchain — finds bootstrap txns)
            indexerClient.searchForTransactions()
                .notePrefix(new TextEncoder().encode(VAULT_NOTE_PREFIX + address))
                .do()
                .catch(() => ({ transactions: [] })),

            // Method 2: Address-involved txn search (fallback)
            indexerClient.searchForTransactions().address(address).txType('appl')
                .do()
                .catch(() => ({ transactions: [] }))
        ])

        // Add Supabase results
        supabaseIds.forEach(id => foundIds.add(id))
        if (supabaseIds.length > 0) console.log(`  Supabase: found ${supabaseIds.length} vault(s)`)

        // Add note-prefix results
        const noteTransactions = (noteTxs as any).transactions || []
        noteTransactions.forEach((tx: any) => {
            const appId = tx['application-transaction']?.['application-id']
            if (appId) foundIds.add(appId.toString())
        })

        // Add address search results
        const addrTransactions = (involvedTxs as any).transactions || []
        addrTransactions.forEach((tx: any) => {
            const appId = tx['application-transaction']?.['application-id']
            if (appId) foundIds.add(appId.toString())
        })

        // Method 3: localStorage fallback
        if (typeof window !== 'undefined') {
            try {
                const registry = localStorage.getItem('trustvault_beneficiary_registry')
                if (registry) {
                    const map: Record<string, string[]> = JSON.parse(registry)
                        ; (map[address.toUpperCase()] || []).forEach(id => foundIds.add(id))
                }
            } catch (e) { /* ignore */ }
            try {
                const cached = localStorage.getItem(`trustvault_ids_${address}`)
                if (cached) JSON.parse(cached).forEach((id: string) => foundIds.add(id))
            } catch (e) { /* ignore */ }
        }

        const allIds = Array.from(foundIds).map(id => BigInt(id))
        if (allIds.length === 0) {
            console.log(`Beneficiary scan for ${address.slice(0, 8)}...: No vaults found`)
            return []
        }

        console.log(`Beneficiary scan: Checking ${allIds.length} vault(s)...`)

        // Fetch ALL vault states in parallel
        const states = await Promise.all(
            allIds.map(id => fetchVaultState(id).catch(() => null))
        )

        const now = Math.floor(Date.now() / 1000)
        const results: ClaimableVault[] = []

        states.forEach((state, idx) => {
            if (!state) return

            const beneficiaryMatch = (state.beneficiary || '').toUpperCase() === address.toUpperCase()
            const isExpired = now >= (state.lastHeartbeat + state.lockDuration)
            const notReleased = !state.released

            if (beneficiaryMatch) {
                console.log(`  Vault #${allIds[idx]}: BENEFICIARY ✓ expired=${isExpired ? 'YES' : 'no'} released=${state.released ? 'YES' : 'no'}`)
            }

            if (beneficiaryMatch && isExpired && notReleased) {
                results.push({ appId: allIds[idx], state })
            }
        })

        console.log(`Beneficiary Discovery: ${results.length} claimable vault(s)!`)
        return results
    } catch (error) {
        console.error('Error discovering beneficiary vaults:', error)
        return []
    }
}

// Save beneficiary-to-vault mapping in global localStorage registry
export const saveBeneficiaryMapping = (beneficiaryAddress: string, appId: bigint) => {
    if (typeof window === 'undefined') return
    try {
        const registry: Record<string, string[]> = JSON.parse(
            localStorage.getItem('trustvault_beneficiary_registry') || '{}'
        )
        const key = beneficiaryAddress.toUpperCase()
        if (!registry[key]) registry[key] = []
        const idStr = appId.toString()
        if (!registry[key].includes(idStr)) {
            registry[key].push(idStr)
        }
        localStorage.setItem('trustvault_beneficiary_registry', JSON.stringify(registry))
        console.log(`Saved vault #${idStr} for beneficiary ${beneficiaryAddress.slice(0, 8)}...`)
    } catch (e) {
        console.warn('Failed to save beneficiary mapping:', e)
    }
}

// Check account balance before vault creation
export const checkAccountBalance = async (address: string, requiredMicroAlgos: number): Promise<{ ok: boolean, balance: number, needed: number }> => {
    try {
        const info = await algodClient.accountInformation(address).do()
        const balance = Number(info.amount || 0)
        const minBalance = Number((info as any).minBalance || (info as any)['min-balance'] || 100000)
        const available = balance - minBalance
        return {
            ok: available >= requiredMicroAlgos,
            balance: balance,
            needed: minBalance + requiredMicroAlgos
        }
    } catch (e) {
        return { ok: true, balance: 0, needed: 0 } // Allow attempt if check fails
    }
}

// Get vault's ALGO balance
export const getVaultBalance = async (appId: bigint): Promise<number> => {
    try {
        const appAddress = getAppAddress(appId)
        const info = await algodClient.accountInformation(appAddress).do()
        return Number(info.amount || 0) / 1_000_000
    } catch (e) {
        return 0
    }
}

// Function to deploy a new vault
export const deployVault = async (sender: string, signer: any) => {
    try {
        await new Promise(resolve => setTimeout(resolve, 500))
        const params = await algodClient.getTransactionParams().do()

        // Compile programs
        const approvalRes = await algodClient.compile(APPROVAL_TEAL).do()
        const clearRes = await algodClient.compile(CLEAR_TEAL).do()

        const approvalProgram = new Uint8Array(Buffer.from(approvalRes.result, 'base64'))
        const clearProgram = new Uint8Array(Buffer.from(clearRes.result, 'base64'))

        // Create the application creation transaction
        const txn = algosdk.makeApplicationCreateTxnFromObject({
            sender: sender,
            suggestedParams: params,
            onComplete: algosdk.OnApplicationComplete.NoOpOC,
            approvalProgram: approvalProgram,
            clearProgram: clearProgram,
            numLocalInts: 0,
            numLocalByteSlices: 0,
            numGlobalInts: 3, // LockDuration, LastHeartbeat, Released
            numGlobalByteSlices: 2, // Owner, Beneficiary
            note: new TextEncoder().encode(`TrustVault:deploy:${Date.now()}`)
        })

        // Use ATC for deployment as it's more reliable with Pera
        const atc = new algosdk.AtomicTransactionComposer()
        atc.addTransaction({
            txn: txn,
            signer: signer
        })

        const result = await atc.execute(algodClient, 4)
        const txId = result.txIDs[0]
        console.log('App Create TxID:', txId)

        await algosdk.waitForConfirmation(algodClient, txId, 4)

        const txInfo = await algodClient.pendingTransactionInformation(txId).do()
        return txInfo.applicationIndex
    } catch (error) {
        console.error('Deployment failed:', error)
        throw error
    }
}

// Global State Keys
export const STATE_KEYS = {
    OWNER: 'Owner',
    BENEFICIARY: 'Beneficiary',
    LOCK_DURATION: 'LockDuration',
    LAST_HEARTBEAT: 'LastHeartbeat',
    RELEASED: 'Released'
}

// Type for contract state
export interface VaultState {
    owner: string
    beneficiary: string
    lockDuration: number
    lastHeartbeat: number
    released: boolean
}

// Fetch contract state
export async function fetchVaultState(appId: number | bigint): Promise<VaultState | null> {
    try {
        const appInfo = await algodClient.getApplicationByID(appId).do()
        const globalState = appInfo.params?.globalState || []
        const senderAddr = appInfo.params?.creator || ''

        const state: any = {}
        globalState.forEach((item: any) => {
            const key = Buffer.from(item.key, 'base64').toString()
            const value = item.value
            if (value.type === 1) { // Bytes
                const addr = algosdk.encodeAddress(Buffer.from(value.bytes, 'base64'))
                state[key] = String(addr)
            } else { // Uint
                state[key] = Number(value.uint)
            }
        })

        return {
            owner: String(state[STATE_KEYS.OWNER] || senderAddr),
            beneficiary: String(state[STATE_KEYS.BENEFICIARY] || ''),
            lockDuration: Number(state[STATE_KEYS.LOCK_DURATION]) || 0,
            lastHeartbeat: Number(state[STATE_KEYS.LAST_HEARTBEAT]) || 0,
            released: state[STATE_KEYS.RELEASED] === 1
        }
    } catch (error) {
        console.error('Failed to fetch vault state:', error)
        return null
    }
}

// Call heartbeat function
export async function callHeartbeat(
    appId: number | bigint,
    senderAddress: string,
    signer: any
): Promise<string> {
    const suggestedParams = await algodClient.getTransactionParams().do()
    const method = new algosdk.ABIMethod({
        name: 'heartbeat',
        args: [],
        returns: { type: 'void' }
    })

    const atc = new algosdk.AtomicTransactionComposer()
    atc.addMethodCall({
        appID: appId,
        method: method,
        sender: senderAddress,
        suggestedParams: { ...suggestedParams, flatFee: true, fee: 2000 },
        signer: signer,
        note: new TextEncoder().encode(`TrustVault:heartbeat:${Date.now()}`)
    })

    const result = await atc.execute(algodClient, 4)
    return result.txIDs[0]
}

// Call auto_release function
export async function callAutoRelease(
    appId: number | bigint,
    senderAddress: string,
    signer: any
): Promise<string> {
    const suggestedParams = await algodClient.getTransactionParams().do()
    const method = new algosdk.ABIMethod({
        name: 'auto_release',
        args: [],
        returns: { type: 'void' }
    })

    const atc = new algosdk.AtomicTransactionComposer()
    atc.addMethodCall({
        appID: appId,
        method: method,
        sender: senderAddress,
        suggestedParams: { ...suggestedParams, flatFee: true, fee: 3000 }, // Higher fee for release as it sends funds
        signer: signer,
        note: new TextEncoder().encode(`TrustVault:claim:${Date.now()}`)
    })

    const result = await atc.execute(algodClient, 4)
    return result.txIDs[0]
}

// Deposit ALGO to the vault
export async function depositAlgo(
    sender: string,
    vaultAddress: string,
    amountInAlgos: number,
    signer: any
) {
    const params = await algodClient.getTransactionParams().do()
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: sender,
        receiver: vaultAddress,
        amount: Math.round(amountInAlgos * 1_000_000), // Convert to microAlgos
        suggestedParams: params,
    })

    const result = await signer([txn])
    const signedTxn = Array.isArray(result) ? result[0] : result
    const response = await algodClient.sendRawTransaction(signedTxn).do()
    await algosdk.waitForConfirmation(algodClient, response.txid, 4)
    return response.txid
}

// Call withdraw function
export async function callWithdraw(
    appId: number | bigint,
    amount: number,
    senderAddress: string,
    signer: any
): Promise<string> {
    const suggestedParams = await algodClient.getTransactionParams().do()
    const method = new algosdk.ABIMethod({
        name: 'withdraw',
        args: [{ type: 'uint64', name: 'amount' }],
        returns: { type: 'void' }
    })

    const atc = new algosdk.AtomicTransactionComposer()
    atc.addMethodCall({
        appID: appId,
        method: method,
        methodArgs: [BigInt(Math.round(amount * 1_000_000))], // Amount in microAlgos
        sender: senderAddress,
        suggestedParams: { ...suggestedParams, flatFee: true, fee: 2000 },
        signer: signer,
        note: new TextEncoder().encode(`TrustVault:withdraw:${Date.now()}`)
    })

    const result = await atc.execute(algodClient, 4)
    return result.txIDs[0]
}

// Get application address
export function getAppAddress(appId: number | bigint): string {
    const addr = algosdk.getApplicationAddress(appId)
    return String(addr)
}
