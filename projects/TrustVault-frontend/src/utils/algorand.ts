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
        const specificNote = new TextEncoder().encode(VAULT_NOTE_PREFIX + address)
        const generalNote = new TextEncoder().encode(VAULT_NOTE_PREFIX)

        // Search for apps where user is creator OR where user is involved in an App Transaction
        const [createdApps, specificNoteTxs, generalNoteTxs, involvedTxs, stateSearch] = await Promise.all([
            // 1. Apps created by this user
            indexerClient.searchForApplications().creator(address).do().catch(() => ({ applications: [] })),
            // 2. Transactions tagged with this beneficiary's discovery note (Exact)
            indexerClient.searchForTransactions().notePrefix(specificNote).do().catch(() => ({ transactions: [] })),
            // 3. Transactions with general vault prefix (Backup)
            indexerClient.searchForTransactions().notePrefix(generalNote).do().catch(() => ({ transactions: [] })),
            // 4. Transactions where this user was explicitly involved (as an account)
            indexerClient.searchForTransactions().address(address).txType('appl').do().catch(() => ({ transactions: [] })),
            // 5. (Ultimate Jugaar) Apps where the user's address is stored in Global State
            indexerClient.searchForApplications()
                // @ts-ignore - v3 syntax check
                .globalStateByteValue(Buffer.from(algosdk.decodeAddress(address).publicKey).toString('base64'))
                .do().catch(() => ({ applications: [] }))
        ])

        const foundIds = new Set<string>()

        // Helper to process transactions
        const processTxs = (txs: any[]) => {
            txs.forEach((tx: any) => {
                const appId = tx['application-transaction']?.['application-id']
                if (appId) foundIds.add(appId.toString())
            })
        }

        if (createdApps.applications) {
            createdApps.applications.forEach((app: any) => foundIds.add(app.id.toString()))
        }

        if (stateSearch.applications) {
            stateSearch.applications.forEach((app: any) => foundIds.add(app.id.toString()))
        }

        processTxs(specificNoteTxs.transactions || [])
        processTxs(generalNoteTxs.transactions || [])
        processTxs(involvedTxs.transactions || [])

        console.log(`Discovery Results for ${address}: Found ${foundIds.size} unique IDs.`)
        return Array.from(foundIds).map(id => BigInt(id))
    } catch (error) {
        console.error('Error discoverying vaults:', error)
        return []
    }
}

// Function to deploy a new vault
export const deployVault = async (sender: string, signer: any) => {
    try {
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
        })

        const signedResult = await signer([txn])
        const signedTxn = Array.isArray(signedResult) ? signedResult[0] : signedResult

        const response = await algodClient.sendRawTransaction(signedTxn).do()
        const txId = response.txid || ''

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
        suggestedParams: suggestedParams,
        signer: signer
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
        suggestedParams: suggestedParams,
        signer: signer
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

// Get application address
export function getAppAddress(appId: number | bigint): string {
    const addr = algosdk.getApplicationAddress(appId)
    return String(addr)
}
