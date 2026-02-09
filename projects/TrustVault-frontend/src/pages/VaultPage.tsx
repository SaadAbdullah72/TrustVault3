import { useEffect, useState, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import {
    fetchVaultState,
    getAppAddress,
    VaultState,
    algodClient,
    discoverVaults,
    deployVault,
    callHeartbeat,
    callAutoRelease,
    VAULT_NOTE_PREFIX
} from '../utils/algorand'
import Countdown from '../components/Countdown'
import VaultStatus from '../components/VaultStatus'
import algosdk from 'algosdk'

export default function VaultPage() {
    const { activeAddress, wallets, transactionSigner } = useWallet()

    // Selection state
    const [selectedAppId, setSelectedAppId] = useState<bigint | null>(null)
    const [userVaults, setUserVaults] = useState<bigint[]>([])

    // Load from cache on connection
    useEffect(() => {
        if (activeAddress && typeof window !== 'undefined') {
            const cached = localStorage.getItem(`trustvault_ids_${activeAddress}`)
            if (cached) {
                try {
                    const ids = JSON.parse(cached).map((id: string) => BigInt(id))
                    setUserVaults(ids)
                    if (ids.length > 0) setSelectedAppId(ids[0])
                } catch (e) {
                    console.error('Failed to parse cached vaults:', e)
                }
            } else {
                setUserVaults([])
            }
        }
    }, [activeAddress])

    // UI state
    const [vaultState, setVaultState] = useState<VaultState | null>(null)
    const [loading, setLoading] = useState(false)
    const [discovering, setDiscovering] = useState(false)
    const [error, setError] = useState('')
    const [txId, setTxId] = useState('')

    // Form state
    const [beneficiaryInput, setBeneficiaryInput] = useState('')
    const [lockDurationInput, setLockDurationInput] = useState('60')
    const [depositInput, setDepositInput] = useState('1')
    const [showCreateForm, setShowCreateForm] = useState(false)
    const [importIdInput, setImportIdInput] = useState('')
    const [showImportForm, setShowImportForm] = useState(false)

    // Load available vaults
    const loadUserVaults = useCallback(async () => {
        if (!activeAddress) return
        setDiscovering(true)
        try {
            const ids = await discoverVaults(activeAddress)
            setUserVaults(ids)
            // Cache results
            localStorage.setItem(`trustvault_ids_${activeAddress}`, JSON.stringify(ids.map(id => id.toString())))

            if (ids.length > 0 && selectedAppId === null) {
                setSelectedAppId(ids[0])
            }
        } catch (e) {
            console.error('Discovery error', e)
        } finally {
            setDiscovering(false)
        }
    }, [activeAddress, selectedAppId])

    // Load state for selected vault
    const loadVaultState = useCallback(async () => {
        if (selectedAppId === null) return
        try {
            const state = await fetchVaultState(selectedAppId)
            setVaultState(state)
        } catch (e) {
            console.error('State load error', e)
        }
    }, [selectedAppId])

    // Disconnect helper
    const startDisconnect = async (wallet: any) => {
        if (wallet) await wallet.disconnect()
        setSelectedAppId(null)
        setUserVaults([])
    }

    const handleCreateVault = async () => {
        if (!activeAddress) return
        if (!beneficiaryInput || !lockDurationInput || !depositInput) {
            setError('Please fill all fields')
            return
        }

        setLoading(true)
        setError('')
        try {
            const appId = await deployVault(activeAddress, transactionSigner)
            if (!appId) throw new Error('Deployment failed')

            setTxId('Vault Created! Finalizing setup (4s)...')
            await new Promise(resolve => setTimeout(resolve, 4000))

            const appAddress = getAppAddress(appId)
            const suggestedParams = await algodClient.getTransactionParams().do()
            const method = new algosdk.ABIMethod({
                name: 'bootstrap',
                args: [{ name: 'beneficiary', type: 'address' }, { name: 'lock_duration', type: 'uint64' }],
                returns: { type: 'void' }
            })

            const encodedNote = new TextEncoder().encode(VAULT_NOTE_PREFIX + beneficiaryInput.trim())
            const atc = new algosdk.AtomicTransactionComposer()

            Object.defineProperty(atc, 'addMethodCall', { value: (atc as any).addMethodCall, writable: true })
                ; (atc as any).addMethodCall({
                    appID: appId,
                    method: method,
                    sender: activeAddress,
                    suggestedParams: { ...suggestedParams, flatFee: true, fee: 1000 },
                    signer: transactionSigner,
                    methodArgs: [beneficiaryInput.trim(), BigInt(lockDurationInput)],
                    accounts: [beneficiaryInput.trim()],
                    note: encodedNote
                })

            const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
                sender: activeAddress,
                receiver: appAddress,
                amount: Math.round(parseFloat(depositInput) * 1_000_000),
                suggestedParams: suggestedParams,
            })
            atc.addTransaction({ txn: payTxn, signer: transactionSigner })

            await atc.execute(algodClient, 4)
            setSelectedAppId(appId)
            await loadUserVaults()
            setShowCreateForm(false)
            setTxId('Vault successfully established and funded!')
        } catch (e: any) {
            setError(e.message || 'Creation failed')
        } finally {
            setLoading(false)
        }
    }

    const handleImportVault = async () => {
        if (!importIdInput) return
        try {
            const id = BigInt(importIdInput)
            if (!userVaults.includes(id)) {
                setUserVaults(prev => [...prev, id])
                localStorage.setItem(`trustvault_ids_${activeAddress}`, JSON.stringify([...userVaults, id].map(i => i.toString())))
            }
            setSelectedAppId(id)
            setShowImportForm(false)
            setImportIdInput('')
            setTxId('Vault Imported!')
        } catch (e) {
            setError('Invalid App ID')
        }
    }

    const handleHeartbeat = async () => {
        if (!activeAddress || !selectedAppId) return
        setLoading(true)
        setError('')
        try {
            const id = await callHeartbeat(selectedAppId, activeAddress, transactionSigner)
            setTxId(`Heartbeat confirmed! TX: ${id}`)
            await loadVaultState()
        } catch (e: any) {
            setError(e.message || 'Heartbeat failed')
        } finally {
            setLoading(false)
        }
    }

    const handleClaim = async () => {
        if (!activeAddress || !selectedAppId) return
        setLoading(true)
        setError('')
        try {
            const id = await callAutoRelease(selectedAppId, activeAddress, transactionSigner)
            setTxId(`Inheritance claimed! TX: ${id}`)
            await loadVaultState()
        } catch (e: any) {
            setError(e.message || 'Claim failed')
        } finally {
            setLoading(false)
        }
    }

    const handleScanForClaims = async () => {
        if (!activeAddress) return
        setLoading(true)
        setTxId('Searching for vaults...')
        setError('')
        try {
            const ids = await discoverVaults(activeAddress)
            if (ids.length > 0) {
                const unique = Array.from(new Set([...userVaults, ...ids]))
                setUserVaults(unique)
                localStorage.setItem(`trustvault_ids_${activeAddress}`, JSON.stringify(unique.map(i => i.toString())))
                setSelectedAppId(ids[0])
                setTxId(`Scan complete! Found ${ids.length} vault(s).`)
            } else {
                setTxId('No vaults found.')
            }
        } catch (e: any) {
            setError(e.message || 'Scan failed')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (activeAddress) loadUserVaults()
    }, [activeAddress, loadUserVaults])

    useEffect(() => {
        if (selectedAppId) {
            loadVaultState()
            const interval = setInterval(loadVaultState, 5000)
            return () => clearInterval(interval)
        } else {
            setVaultState(null)
            return undefined
        }
    }, [selectedAppId, loadVaultState])

    const isOwner = activeAddress && String(vaultState?.owner || '').toUpperCase() === activeAddress.toUpperCase()
    const isBeneficiary = activeAddress && String(vaultState?.beneficiary || '').toUpperCase() === activeAddress.toUpperCase()
    const now = Math.floor(Date.now() / 1000)
    const canRelease = !!(vaultState && !vaultState.released && (now >= (vaultState.lastHeartbeat || 0) + (vaultState.lockDuration || 0)))
    const isExpired = !!(vaultState && !vaultState.released && (now >= (vaultState.lastHeartbeat || 0) + (vaultState.lockDuration || 0)))

    return (
        <div className="max-w-4xl mx-auto p-6 font-['Outfit',sans-serif] min-h-screen text-slate-100 selection:bg-blue-500/30">
            {/* Header */}
            <div className="flex justify-between items-center mb-10 pb-6 border-b border-slate-800/50 backdrop-blur-md sticky top-0 z-50">
                <div className="flex items-center gap-2">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <span className="text-white font-black text-xl">T</span>
                    </div>
                    <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-violet-400 tracking-tight">TrustVault</h1>
                </div>

                {activeAddress ? (
                    <div className="flex items-center gap-4 bg-slate-800/40 p-1.5 pr-4 rounded-full border border-slate-700/50 backdrop-blur-sm">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-400 to-teal-500 flex items-center justify-center">
                            <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Connected</div>
                            <div className="text-sm text-emerald-400 font-mono font-bold leading-none">{activeAddress.slice(0, 6)}...{activeAddress.slice(-4)}</div>
                        </div>
                        <button onClick={() => startDisconnect(wallets.find(w => w.isActive))} className="ml-2 px-3 py-1 text-xs font-bold text-red-400 hover:text-white bg-red-400/10 hover:bg-red-500 rounded-full border border-red-500/30 transition-all duration-300">Log Out</button>
                    </div>
                ) : (
                    <button onClick={() => wallets[0]?.connect()} className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl font-bold shadow-lg shadow-blue-600/30 hover:scale-[1.02] active:scale-95 transition-all duration-300">Connect Wallet</button>
                )}
            </div>

            {!activeAddress ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                    <h2 className="text-6xl md:text-7xl font-black mb-6">Secure Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-500">Legacy</span></h2>
                    <p className="max-w-xl text-lg text-slate-400 mb-10">Create an automatic inheritance vault that releases funds to your loved ones if you don't check in.</p>
                    <button onClick={() => wallets[0]?.connect()} className="px-10 py-5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-2xl font-black text-xl shadow-2xl hover:scale-105 transition-all">Get Started →</button>
                </div>
            ) : (
                <>
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-12 bg-slate-900/50 p-4 rounded-2xl border border-slate-800/50">
                        <div className="flex flex-wrap items-end gap-3 w-full md:w-auto">
                            {userVaults.length > 0 && (
                                <div className="flex flex-col gap-1.5 min-w-[200px]">
                                    <label className="text-[10px] text-slate-500 font-black uppercase tracking-widest px-1">SELECT VAULT</label>
                                    <select value={selectedAppId?.toString() || ''} onChange={(e) => setSelectedAppId(BigInt(e.target.value))} className="bg-slate-800 text-white px-4 py-2.5 rounded-xl border border-slate-700 outline-none focus:ring-2 focus:ring-blue-500/50 w-full">
                                        {userVaults.map(id => <option key={id.toString()} value={id.toString()}>Vault ID #{id.toString()}</option>)}
                                    </select>
                                </div>
                            )}
                            <button onClick={handleScanForClaims} disabled={loading || discovering} className="px-5 py-2.5 bg-violet-600/20 text-violet-400 hover:bg-violet-600 hover:text-white border border-violet-500/30 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                                {loading ? 'Scanning...' : <><span className="text-base">🔍</span> Scan inheritance</>}
                            </button>
                        </div>
                        <div className="flex items-center gap-3 w-full md:w-auto">
                            <button onClick={() => { setShowImportForm(!showImportForm); setShowCreateForm(false) }} className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold transition-all ${showImportForm ? 'bg-slate-700' : 'bg-blue-600/10 border border-blue-500/20'}`}>{showImportForm ? 'Close' : 'Import ID'}</button>
                            <button onClick={() => { setShowCreateForm(!showCreateForm); setShowImportForm(false) }} className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold transition-all ${showCreateForm ? 'bg-slate-700' : 'bg-emerald-600 shadow-emerald-600/20 shadow-lg'}`}>{showCreateForm ? 'Close' : '+ New Vault'}</button>
                        </div>
                    </div>

                    {showImportForm && (
                        <div className="mb-12 p-6 bg-slate-900/60 rounded-2xl border border-blue-500/20 backdrop-blur-md">
                            <h3 className="text-lg font-black mb-4 text-blue-400">Import Existing Vault</h3>
                            <div className="flex gap-3">
                                <input value={importIdInput} onChange={(e) => setImportIdInput(e.target.value)} placeholder="Application ID" className="flex-1 bg-slate-950 px-4 py-3 rounded-xl border border-slate-800 outline-none text-white font-mono" />
                                <button onClick={handleImportVault} className="px-8 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg transition-all">Import</button>
                            </div>
                        </div>
                    )}

                    {showCreateForm && (
                        <div className="mb-12 p-8 bg-slate-900/60 rounded-3xl border border-emerald-500/20 backdrop-blur-md">
                            <h3 className="text-2xl font-black mb-6 text-emerald-400">🛡️ Create New Vault</h3>
                            <div className="space-y-6">
                                <div><label className="block text-[10px] font-black text-slate-500 uppercase mb-2">Beneficiary Address</label><input value={beneficiaryInput} onChange={(e) => setBeneficiaryInput(e.target.value)} className="w-full bg-slate-950 px-4 py-3.5 rounded-xl border border-slate-800 outline-none font-mono text-sm" /></div>
                                <div className="grid grid-cols-2 gap-6">
                                    <div><label className="block text-[10px] font-black text-slate-500 uppercase mb-2">Release Timer (Sec)</label><input type="number" value={lockDurationInput} onChange={(e) => setLockDurationInput(e.target.value)} className="w-full bg-slate-950 px-4 py-3.5 rounded-xl border border-slate-800" /></div>
                                    <div><label className="block text-[10px] font-black text-slate-500 uppercase mb-2">Initial Deposit (ALGO)</label><input type="number" value={depositInput} onChange={(e) => setDepositInput(e.target.value)} className="w-full bg-slate-950 px-4 py-3.5 rounded-xl border border-slate-800" /></div>
                                </div>
                                <button onClick={handleCreateVault} disabled={loading} className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black rounded-2xl shadow-xl hover:from-emerald-500 transition-all">{loading ? 'Processing...' : 'ESTABLISH & FUND VAULT'}</button>
                            </div>
                        </div>
                    )}

                    {discovering ? (
                        <div className="flex flex-col items-center py-20 animate-pulse"><div className="w-12 h-12 border-4 border-t-blue-500 rounded-full animate-spin mb-4" /><div className="text-sm font-bold text-slate-500">Syncing Blockchain</div></div>
                    ) : selectedAppId && vaultState ? (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex justify-between items-start">
                                <div className="space-y-3">
                                    <VaultStatus released={vaultState.released || false} />
                                    <div className="flex gap-2">
                                        {isOwner && <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-black border border-blue-500/20 rounded">Vault Owner</span>}
                                        {isBeneficiary && <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[10px] font-black border border-emerald-500/20 rounded">Beneficiary</span>}
                                    </div>
                                </div>
                                <div className="text-right"><div className="text-[10px] text-slate-500 font-bold uppercase">Protocol ID</div><div className="text-sm font-mono text-slate-400">#{selectedAppId?.toString()}</div></div>
                            </div>
                            <div className="p-12 bg-slate-900/60 rounded-[2.5rem] border border-slate-800/50 shadow-inner text-center">
                                <Countdown lastHeartbeat={vaultState.lastHeartbeat} lockDuration={vaultState.lockDuration} released={vaultState.released} />
                            </div>
                            <div className="space-y-4">
                                {isOwner && !vaultState.released && <button onClick={handleHeartbeat} disabled={loading || isExpired} className={`w-full py-5 rounded-2xl font-black text-lg transition-all shadow-xl ${isExpired ? 'bg-slate-800 text-slate-500' : 'bg-gradient-to-r from-blue-600 to-blue-500'}`}>{loading ? 'Transmitting Heartbeat...' : isExpired ? 'VITAL SIGNS LOST' : 'TRANSMIT HEARTBEAT'}</button>}
                                {isBeneficiary && !vaultState.released && <button onClick={handleClaim} disabled={loading || !canRelease} className={`w-full py-5 rounded-2xl font-black text-lg transition-all shadow-xl ${canRelease ? 'bg-gradient-to-r from-red-600 to-rose-600' : 'bg-slate-800 text-slate-500'}`}>{loading ? 'Executing Claim...' : canRelease ? 'EXECUTE INHERITANCE CLAIM' : 'CLAIM LOCKED (TIMER RUNNING)'}</button>}
                            </div>
                            <div className="grid grid-cols-2 gap-4 mt-8">
                                <div className="p-5 bg-slate-950/50 rounded-2xl border border-slate-800/50"><div className="text-[10px] text-slate-500 font-black mb-1.5 uppercase tracking-widest">Designated Beneficiary</div><div className="text-sm font-mono text-slate-300 truncate">{vaultState.beneficiary}</div></div>
                                <div className="p-5 bg-slate-950/50 rounded-2xl border border-slate-800/50"><div className="text-[10px] text-slate-500 font-black mb-1.5 uppercase tracking-widest">Security Lock Window</div><div className="text-sm font-black text-slate-300">{Math.floor(vaultState.lockDuration / 60)} Minutes</div></div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-20 border-2 border-dashed border-slate-800 rounded-3xl"><div className="text-4xl mb-4">🛡️</div><h3 className="text-xl font-bold text-slate-400">No Vault Selected</h3><p className="text-slate-500 text-sm">Select a vault or scan for your inheritance.</p></div>
                    )}

                    {/* Status Display */}
                    {(txId || error) && (
                        <div className={`mt-8 p-4 rounded-xl text-sm font-bold border ${error ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
                            {error || txId}
                        </div>
                    )}
                </>
            )}
        </div>
    )
}
