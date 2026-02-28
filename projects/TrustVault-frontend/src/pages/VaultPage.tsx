import { useEffect, useState, useCallback } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import {
    fetchVaultState,
    getAppAddress,
    VaultState,
    algodClient,
    discoverVaults,
    discoverBeneficiaryVaults,
    ClaimableVault,
    deployVault,
    callHeartbeat,
    callAutoRelease,
    callWithdraw,
    saveBeneficiaryMapping,
    checkAccountBalance,
    getVaultBalance,
    VAULT_NOTE_PREFIX
} from '../utils/algorand'
import { saveVaultToRegistry } from '../utils/supabase'
import Countdown from '../components/Countdown'
import VaultStatus from '../components/VaultStatus'
import NeuralBackground from '../components/NeuralBackground'
import algosdk from 'algosdk'
import {
    Shield,
    Lock,
    Unlock,
    Activity,
    Search,
    Plus,
    X,
    Wallet,
    Clock,
    AlertTriangle,
    CheckCircle,
    LogOut,
    ChevronDown,
    ArrowRight,
    Zap
} from 'lucide-react'

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
    const [vaultBalance, setVaultBalance] = useState<number>(0)
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

    // Beneficiary auto-discovery state
    const [claimableVaults, setClaimableVaults] = useState<ClaimableVault[]>([])
    const [scanningClaims, setScanningClaims] = useState(false)

    // Load available vaults (filter out released ones)
    const loadUserVaults = useCallback(async () => {
        if (!activeAddress) return
        setDiscovering(true)
        try {
            const ids = await discoverVaults(activeAddress)

            // Filter out released/dead vaults
            const activeVaults: bigint[] = []
            const states = await Promise.all(
                ids.map(id => fetchVaultState(id).catch(() => null))
            )
            ids.forEach((id, idx) => {
                const state = states[idx]
                // Keep if state couldn't be fetched (benefit of doubt) or if not released
                if (!state || !state.released) {
                    activeVaults.push(id)
                }
            })

            setUserVaults(activeVaults)
            // Cache results
            localStorage.setItem(`trustvault_ids_${activeAddress}`, JSON.stringify(activeVaults.map(id => id.toString())))

            if (activeVaults.length > 0 && selectedAppId === null) {
                setSelectedAppId(activeVaults[0])
            }
        } catch (e) {
            console.error('Discovery error', e)
        } finally {
            setDiscovering(false)
        }
    }, [activeAddress, selectedAppId])

    // Auto-discover claimable vaults for beneficiary
    const scanForClaimableVaults = useCallback(async () => {
        if (!activeAddress) return
        setScanningClaims(true)
        try {
            const vaults = await discoverBeneficiaryVaults(activeAddress)
            setClaimableVaults(vaults)
        } catch (e) {
            console.error('Beneficiary scan error', e)
        } finally {
            setScanningClaims(false)
        }
    }, [activeAddress])

    // Auto-scan on connect + every 30 seconds
    useEffect(() => {
        if (activeAddress) {
            scanForClaimableVaults()
            const interval = setInterval(scanForClaimableVaults, 30000)
            return () => clearInterval(interval)
        } else {
            setClaimableVaults([])
        }
    }, [activeAddress, scanForClaimableVaults])

    // Load state for selected vault
    const loadVaultState = useCallback(async () => {
        if (selectedAppId === null) return
        try {
            const [state, balance] = await Promise.all([
                fetchVaultState(selectedAppId),
                getVaultBalance(selectedAppId)
            ])
            setVaultState(state)
            setVaultBalance(balance)
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
            // Check balance before attempting
            const depositMicro = Math.round(parseFloat(depositInput) * 1_000_000)
            const totalNeeded = depositMicro + 500_000 // deposit + fees + min balance buffer
            const balCheck = await checkAccountBalance(activeAddress, totalNeeded)
            if (!balCheck.ok) {
                setError(`Insufficient balance! You have ${(balCheck.balance / 1_000_000).toFixed(2)} ALGO but need ~${(balCheck.needed / 1_000_000).toFixed(2)} ALGO (including minimum balance). Fund your account first.`)
                setLoading(false)
                return
            }

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
                amount: depositMicro,
                suggestedParams: suggestedParams,
            })
            atc.addTransaction({ txn: payTxn, signer: transactionSigner })

            await atc.execute(algodClient, 4)

            // Save beneficiary mapping to cloud (Supabase) + localStorage
            saveBeneficiaryMapping(beneficiaryInput.trim(), appId)
            saveVaultToRegistry(appId.toString(), beneficiaryInput.trim(), activeAddress)

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

    const handleWithdraw = async () => {
        if (!activeAddress || !selectedAppId) return
        const amountStr = window.prompt('Enter amount to withdraw (ALGO):')
        if (!amountStr) return

        const amount = parseFloat(amountStr)
        if (isNaN(amount) || amount <= 0) {
            setError('Invalid amount')
            return
        }

        setLoading(true)
        setError('')
        try {
            const id = await callWithdraw(selectedAppId, amount, activeAddress, transactionSigner)
            setTxId(`Funds Withdrawn! TX: ${id}`)
            await loadVaultState()
        } catch (e: any) {
            setError(e.message || 'Withdrawal failed')
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
            // Also refresh claimable vaults
            await scanForClaimableVaults()
        } catch (e: any) {
            setError(e.message || 'Scan failed')
        } finally {
            setLoading(false)
        }
    }

    // Direct claim for auto-discovered beneficiary vaults (no import needed)
    const handleDirectClaim = async (vaultAppId: bigint) => {
        if (!activeAddress) return
        setLoading(true)
        setError('')
        try {
            const id = await callAutoRelease(vaultAppId, activeAddress, transactionSigner)
            setTxId(`Inheritance funds claimed! TX: ${id}`)
            // Remove from claimable list
            setClaimableVaults(prev => prev.filter(v => v.appId !== vaultAppId))
            // Refresh
            await scanForClaimableVaults()
        } catch (e: any) {
            setError(e.message || 'Claim failed')
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
        <div className="premium-bg min-h-screen text-slate-100 font-['Outfit',sans-serif] selection:bg-violet-500/30 overflow-x-hidden">
            {/* Animated Neural Network Background */}
            <NeuralBackground />

            {/* Header */}
            <div className="glass-premium sticky top-0 z-50 px-6 py-4 mb-8">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-3 group cursor-pointer">
                        <div className="relative w-12 h-12 flex items-center justify-center transition-transform group-hover:scale-110 duration-300">
                            <div className="absolute inset-0 bg-violet-500/20 rounded-xl blur-lg group-hover:bg-violet-500/40 transition-all"></div>
                            <Shield className="w-10 h-10 text-violet-400 fill-violet-500/10 stroke-[1.5] drop-shadow-[0_0_10px_rgba(139,92,246,0.5)]" />
                            <div className="absolute bottom-0 right-0">
                                <CheckCircle className="w-4 h-4 text-emerald-400 fill-emerald-950 stroke-2" />
                            </div>
                        </div>
                        <div>
                            <h1 className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-200 to-slate-400 glow-text flex items-center gap-2">
                                TRUSTVAULT
                                <span className="px-2 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-[10px] text-violet-300 font-bold tracking-widest shadow-[0_0_10px_rgba(139,92,246,0.2)]">PRO</span>
                            </h1>
                        </div>
                    </div>

                    {activeAddress ? (
                        <div className="flex items-center gap-2 md:gap-4 bg-slate-950/40 p-1.5 pr-3 md:pr-5 rounded-full border border-white/5 backdrop-blur-md shadow-xl hover:border-violet-500/30 transition-colors group max-w-[280px] md:max-w-none">
                            <div className="relative w-8 h-8 md:w-10 md:h-10 flex-shrink-0">
                                <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping opacity-20"></div>
                                <div className="relative w-full h-full rounded-full bg-gradient-to-tr from-slate-800 to-slate-900 flex items-center justify-center border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                                    <Wallet className="w-4 h-4 md:w-5 md:h-5 text-emerald-400" />
                                </div>
                                <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 md:w-3 md:h-3 bg-emerald-500 border-2 border-slate-900 rounded-full"></div>
                            </div>
                            <div className="text-right min-w-0">
                                <div className="text-[8px] md:text-[9px] text-slate-400 uppercase tracking-widest font-bold group-hover:text-emerald-400 transition-colors">Connected</div>
                                <div className="text-xs md:text-sm text-white font-mono font-bold leading-none tracking-wide text-shadow-sm">{activeAddress.slice(0, 4)}...{activeAddress.slice(-4)}</div>
                            </div>
                            <button onClick={() => startDisconnect(wallets.find(w => w.isActive))} className="ml-1 md:ml-2 p-1.5 md:p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-all duration-300 flex-shrink-0">
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    ) : (
                        <button onClick={() => wallets[0]?.connect()} className="px-8 py-3 bg-white text-slate-950 rounded-xl font-bold hover:scale-105 active:scale-95 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.2)] flex items-center gap-2">
                            <Wallet className="w-5 h-5" />
                            <span>Connect Wallet</span>
                        </button>
                    )}
                </div>
            </div>

            <div className="max-w-6xl mx-auto p-6">
                {!activeAddress ? (
                    <div className="relative z-10">
                        {/* Landing Page Snake Border */}
                        <div className="snake-border p-[2px] rounded-[2rem] md:rounded-[3rem] shadow-[0_0_50px_rgba(139,92,246,0.3)] bg-gradient-to-b from-slate-800/50 to-slate-900/50 backdrop-blur-md max-w-full overflow-hidden mx-4 md:mx-0">
                            <div className="snake-border-left"></div>
                            <div className="snake-border-bottom"></div>
                            <div className="bg-[#020617]/80 rounded-[1.9rem] md:rounded-[2.9rem] p-6 md:p-24 text-center relative overflow-hidden">
                                <div className="w-16 h-16 md:w-24 md:h-24 mb-6 md:mb-8 mx-auto relative group">
                                    <div className="absolute inset-0 bg-violet-500/30 blur-[30px] md:blur-[40px] rounded-full group-hover:bg-violet-500/50 transition-all duration-500"></div>
                                    <Shield className="w-full h-full text-white drop-shadow-[0_0_30px_rgba(139,92,246,0.6)] animate-pulse" strokeWidth={1} />
                                </div>
                                <h2 className="text-4xl md:text-8xl font-black mb-6 md:mb-8 tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 drop-shadow-sm break-words">
                                    Secure Legacy
                                </h2>
                                <p className="max-w-2xl mx-auto text-xl text-slate-400 mb-12 leading-relaxed font-light">
                                    Autonomous inheritance protocol secured by the Algorand blockchain.
                                    <br /><span className="text-emerald-400 font-medium flex items-center justify-center gap-2 mt-2"><CheckCircle className="w-4 h-4" /> Zero-Trust Architecture</span>
                                </p>
                                <button onClick={() => wallets[0]?.connect()} className="group relative px-12 py-6 bg-violet-600 text-white rounded-2xl font-black text-xl overflow-hidden transition-all hover:scale-105 shadow-[0_0_50px_rgba(139,92,246,0.4)] border border-violet-400/50">
                                    <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 opacity-100 group-hover:opacity-90 transition-opacity"></div>
                                    <div className="relative z-10 flex items-center gap-3">
                                        <span>INITIALIZE PROTOCOL</span>
                                        <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="animate-in fade-in slide-in-from-bottom-8 duration-700">
                        {/* ====== CLAIMABLE VAULTS SECTION (Auto-Discovery) ====== */}
                        {claimableVaults.length > 0 && (
                            <div className="mb-12 animate-in fade-in slide-in-from-top-8 duration-700">
                                <div className="snake-border p-[2px] rounded-[2rem] shadow-[0_0_60px_rgba(239,68,68,0.3)] bg-gradient-to-b from-red-900/30 to-slate-900/50">
                                    <div className="snake-border-left"></div>
                                    <div className="snake-border-bottom"></div>
                                    <div className="bg-[#0b101e]/95 backdrop-blur-3xl rounded-[1.9rem] p-8 md:p-12 relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500/80 to-transparent"></div>
                                        <div className="absolute top-0 right-0 w-80 h-80 bg-red-600/10 blur-[100px] rounded-full pointer-events-none"></div>

                                        <div className="relative z-10">
                                            <div className="flex items-center gap-4 mb-8">
                                                <div className="relative w-14 h-14 flex items-center justify-center">
                                                    <div className="absolute inset-0 bg-red-500/20 rounded-xl blur-lg animate-pulse"></div>
                                                    <Zap className="w-8 h-8 text-red-400 drop-shadow-[0_0_15px_rgba(239,68,68,0.6)]" />
                                                </div>
                                                <div>
                                                    <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight">Incoming Inheritance</h2>
                                                    <p className="text-sm text-red-300/70 font-medium mt-1">{claimableVaults.length} vault(s) ready to claim — funds will be sent to your wallet</p>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                {claimableVaults.map((vault) => (
                                                    <div key={vault.appId.toString()} className="p-6 bg-slate-950/60 rounded-2xl border border-red-500/20 hover:border-red-500/40 transition-all group">
                                                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                                            <div className="space-y-2 flex-1">
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Vault ID</span>
                                                                    <span className="text-lg font-mono font-bold text-white">#{vault.appId.toString()}</span>
                                                                    <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-[9px] font-black rounded-full border border-red-500/30 animate-pulse tracking-wider">TIMER EXPIRED</span>
                                                                </div>
                                                                <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                                                                    <span className="flex items-center gap-1"><Shield className="w-3 h-3 text-blue-400" /> Owner: <span className="font-mono text-slate-300">{vault.state.owner.slice(0, 6)}...{vault.state.owner.slice(-4)}</span></span>
                                                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-violet-400" /> Timer: {Math.floor(vault.state.lockDuration / 60)} min</span>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleDirectClaim(vault.appId)}
                                                                disabled={loading}
                                                                className="px-8 py-4 bg-gradient-to-r from-red-600 to-rose-600 text-white font-black text-lg rounded-xl shadow-[0_0_30px_rgba(239,68,68,0.3)] hover:scale-105 hover:shadow-[0_0_40px_rgba(239,68,68,0.5)] active:scale-95 transition-all flex items-center gap-3 group-hover:from-red-500 group-hover:to-rose-500 min-w-[200px] justify-center"
                                                            >
                                                                <Unlock className="w-5 h-5" />
                                                                {loading ? 'CLAIMING...' : 'CLAIM FUNDS'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Scanning indicator */}
                        {scanningClaims && claimableVaults.length === 0 && (
                            <div className="mb-8 flex items-center justify-center gap-3 text-sm text-violet-400 font-bold">
                                <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin"></div>
                                Scanning for claimable inheritances...
                            </div>
                        )}

                        {/* Control Bar */}
                        <div className="glass-premium p-4 rounded-3xl mb-12 flex flex-col md:flex-row justify-between items-center gap-6">
                            <div className="flex flex-wrap items-end gap-3 w-full md:w-auto">
                                {userVaults.length > 0 && (
                                    <div className="flex flex-col gap-2 min-w-[260px]">
                                        <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest px-1 flex items-center gap-1"><Lock className="w-3 h-3" /> Selected Vault</label>
                                        <div className="relative">
                                            <select value={selectedAppId?.toString() || ''} onChange={(e) => setSelectedAppId(BigInt(e.target.value))} className="appearance-none bg-slate-950/60 text-white pl-5 pr-10 py-3.5 rounded-xl border border-white/10 outline-none focus:border-violet-500/50 w-full hover:bg-slate-900 transition-colors cursor-pointer font-mono shadow-inner">
                                                {userVaults.map(id => <option key={id.toString()} value={id.toString()}>VAULT ID #{id.toString()}</option>)}
                                            </select>
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none w-4 h-4" />
                                        </div>
                                    </div>
                                )}
                                <button onClick={handleScanForClaims} disabled={loading || discovering} className="px-6 py-3.5 bg-violet-500/10 text-violet-300 hover:bg-violet-500 hover:text-white border border-violet-500/20 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center gap-3 hover:shadow-[0_0_20px_rgba(139,92,246,0.2)]">
                                    {loading ? <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Search className="w-5 h-5" />}
                                    <span>SCAN NETWORK</span>
                                </button>
                            </div>
                            <div className="flex items-center gap-3 w-full md:w-auto">
                                <button onClick={() => { setShowImportForm(!showImportForm); setShowCreateForm(false) }} className={`flex-1 md:flex-none px-6 py-3.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${showImportForm ? 'bg-slate-700 text-white' : 'bg-slate-800/50 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500'}`}>
                                    {showImportForm ? <X className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                                    <span>{showImportForm ? 'CLOSE' : 'IMPORT'}</span>
                                </button>
                                <button onClick={() => { setShowCreateForm(!showCreateForm); setShowImportForm(false) }} className={`flex-1 md:flex-none px-6 py-3.5 rounded-xl font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${showCreateForm ? 'bg-slate-700 text-white' : 'bg-white text-slate-950 hover:bg-slate-200'}`}>
                                    {showCreateForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                                    <span>{showCreateForm ? 'CLOSE' : 'NEW VAULT'}</span>
                                </button>
                            </div>
                        </div>

                        {/* Forms */}
                        {(showImportForm || showCreateForm) && (
                            <div className="mb-12 glass-premium p-8 rounded-[2rem] border border-white/5 relative overflow-hidden backdrop-blur-2xl">
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-violet-500/50 to-transparent"></div>
                                {showImportForm && (
                                    <div className="animate-in fade-in zoom-in-95">
                                        <h3 className="text-xl font-black mb-6 text-white flex items-center gap-2"><Search className="w-6 h-6 text-violet-400" /> IMPORT EXISTING VAULT</h3>
                                        <div className="flex gap-4">
                                            <input value={importIdInput} onChange={(e) => setImportIdInput(e.target.value)} placeholder="Enter Application ID" className="flex-1 bg-slate-950/50 px-6 py-4 rounded-2xl border border-white/10 outline-none text-white font-mono text-lg focus:border-violet-500/50 transition-colors" />
                                            <button onClick={handleImportVault} className="px-10 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-2xl shadow-xl transition-all hover:shadow-violet-600/20">IMPORT</button>
                                        </div>
                                    </div>
                                )}
                                {showCreateForm && (
                                    <div className="animate-in fade-in zoom-in-95">
                                        <h3 className="text-2xl font-black mb-8 text-white flex items-center gap-3"><Shield className="w-8 h-8 text-emerald-400" /> CONFIGURE NEW VAULT</h3>
                                        <div className="space-y-8">
                                            <div><label className="block text-xs font-black text-slate-400 uppercase mb-3 ml-1 flex items-center gap-2"><ArrowRight className="w-3 h-3" /> Designated Beneficiary Wallet</label><input value={beneficiaryInput} onChange={(e) => setBeneficiaryInput(e.target.value)} className="w-full bg-slate-950/50 px-6 py-4 rounded-2xl border border-white/10 outline-none font-mono text-emerald-400 focus:border-emerald-500/50 transition-colors shadow-inner" placeholder="ADDR..." /></div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                                <div><label className="block text-xs font-black text-slate-400 uppercase mb-3 ml-1 flex items-center gap-2"><Clock className="w-3 h-3" /> Inactivity Timer (Seconds)</label><input type="number" value={lockDurationInput} onChange={(e) => setLockDurationInput(e.target.value)} className="w-full bg-slate-950/50 px-6 py-4 rounded-2xl border border-white/10 outline-none focus:border-emerald-500/50 text-white font-bold" /></div>
                                                <div><label className="block text-xs font-black text-slate-400 uppercase mb-3 ml-1 flex items-center gap-2"><Wallet className="w-3 h-3" /> Initial Deposit (ALGO)</label><input type="number" value={depositInput} onChange={(e) => setDepositInput(e.target.value)} className="w-full bg-slate-950/50 px-6 py-4 rounded-2xl border border-white/10 outline-none focus:border-emerald-500/50 text-white font-bold" /></div>
                                            </div>
                                            <button onClick={handleCreateVault} disabled={loading} className="w-full py-5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-black rounded-2xl shadow-[0_0_30px_rgba(16,185,129,0.2)] hover:scale-[1.01] hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] transition-all relative overflow-hidden group flex items-center justify-center gap-3">
                                                <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                                                <Shield className="w-5 h-5" />
                                                <span>{loading ? 'DEPLOYING CONTRACT...' : 'DEPLOY & FUND VAULT'}</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {discovering ? (
                            <div className="flex flex-col items-center py-32 animate-pulse">
                                <div className="relative w-24 h-24 mb-8">
                                    <div className="absolute inset-0 border-4 border-violet-500/30 rounded-full"></div>
                                    <div className="absolute inset-0 border-4 border-t-violet-500 rounded-full animate-spin"></div>
                                    <Search className="absolute inset-0 m-auto w-8 h-8 text-violet-400" />
                                </div>
                                <div className="text-lg font-bold text-violet-300 tracking-widest uppercase">Synchronizing with Blockchain</div>
                            </div>
                        ) : selectedAppId && vaultState ? (
                            <div className="relative animate-in fade-in slide-in-from-bottom-8 duration-700">
                                {/* Snake Border Wrapper */}
                                <div className="snake-border p-[2px] rounded-[2rem] md:rounded-[2.5rem] shadow-[0_0_60px_rgba(139,92,246,0.1)] bg-slate-900/50 max-w-full overflow-hidden mx-4 md:mx-0">
                                    <div className="snake-border-left"></div>
                                    <div className="snake-border-bottom"></div>
                                    <div className="bg-[#0b101e]/90 backdrop-blur-3xl rounded-[1.9rem] md:rounded-[2.4rem] p-6 md:p-12 relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-96 h-96 bg-violet-600/10 blur-[100px] rounded-full pointer-events-none"></div>
                                        <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-600/5 blur-[100px] rounded-full pointer-events-none"></div>

                                        {/* Vault Content */}
                                        <div className="relative z-10 space-y-8 md:space-y-12">
                                            <div className="flex flex-col md:flex-row justify-between items-start border-b border-white/5 pb-8 gap-6 md:gap-0">
                                                <div className="space-y-4 w-full md:w-auto">
                                                    <VaultStatus released={vaultState.released || false} />
                                                    <div className="flex flex-wrap gap-3">
                                                        {isOwner && <span className="px-3 py-1 bg-blue-500/10 text-blue-300 text-[10px] font-black border border-blue-500/20 rounded-full tracking-wider shadow-[0_0_15px_rgba(59,130,246,0.1)] flex items-center gap-1"><Shield className="w-3 h-3" /> OWNER ACCESS</span>}
                                                        {isBeneficiary && <span className="px-3 py-1 bg-emerald-500/10 text-emerald-300 text-[10px] font-black border border-emerald-500/20 rounded-full tracking-wider shadow-[0_0_15px_rgba(16,185,129,0.1)] flex items-center gap-1"><Wallet className="w-3 h-3" /> BENEFICIARY</span>}
                                                    </div>
                                                </div>
                                                <div className="text-left md:text-right w-full md:w-auto">
                                                    <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1 flex items-center md:justify-end gap-1"><Activity className="w-3 h-3" /> Protocol ID</div>
                                                    <div className="text-2xl md:text-3xl font-mono text-white font-bold drop-shadow-md tracking-tight break-all">#{selectedAppId?.toString()}</div>
                                                </div>
                                            </div>

                                            <div className="py-8 relative">
                                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12 opacity-50 pointer-events-none"></div>
                                                <Countdown lastHeartbeat={vaultState.lastHeartbeat} lockDuration={vaultState.lockDuration} released={vaultState.released} />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                {isOwner && !vaultState.released && (
                                                    <>
                                                        <button onClick={handleHeartbeat} disabled={loading || isExpired} className={`group relative py-6 rounded-2xl font-black text-lg transition-all shadow-xl hover-glow overflow-hidden ${isExpired ? 'bg-slate-800 text-slate-500' : 'bg-gradient-to-r from-blue-600 to-indigo-600'}`}>
                                                            <div className="absolute inset-0 bg-white/20 translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500"></div>
                                                            <span className="relative z-10 flex items-center justify-center gap-2">
                                                                <Activity className="w-5 h-5 animate-pulse" />
                                                                {loading ? 'SIGNALING...' : isExpired ? 'CONNECTION LOST' : 'TRANSMIT HEARTBEAT'}
                                                            </span>
                                                        </button>
                                                        <button onClick={handleWithdraw} disabled={loading} className="group py-6 bg-slate-800/50 hover:bg-slate-800 text-white rounded-2xl font-black text-lg transition-all shadow-lg border border-white/10 hover:border-violet-500/50 hover-glow flex items-center justify-center gap-2">
                                                            <Wallet className="w-5 h-5 text-slate-400 group-hover:text-white transition-colors" />
                                                            WITHDRAW FUNDS
                                                        </button>
                                                    </>
                                                )}
                                                {isBeneficiary && !vaultState.released && (
                                                    <button onClick={handleClaim} disabled={loading || !canRelease} className={`col-span-2 py-6 rounded-2xl font-black text-xl transition-all shadow-xl hover-glow flex items-center justify-center gap-3 ${canRelease ? 'bg-gradient-to-r from-red-500 to-rose-600 animate-pulse' : 'bg-slate-800 text-slate-500 opacity-50'}`}>
                                                        {loading ? 'EXECUTING CONTRACT...' : canRelease ? <><Unlock className="w-6 h-6" /> UNLOCK VAULT FUNDS</> : <><Lock className="w-6 h-6" /> LOCKED (TIMER ACTIVE)</>}
                                                    </button>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-8 border-t border-white/5">
                                                {/* Vault Balance */}
                                                <div className="p-5 bg-gradient-to-br from-emerald-950/40 to-slate-950/40 rounded-2xl border border-emerald-500/10 hover:border-emerald-500/30 transition-all group">
                                                    <div className="text-[10px] text-emerald-400/60 font-black mb-3 uppercase tracking-widest flex items-center gap-1.5">
                                                        <Wallet className="w-3 h-3" /> Vault Balance
                                                    </div>
                                                    <div className="text-2xl font-black text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.3)] group-hover:drop-shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all">
                                                        {vaultBalance.toFixed(3)}
                                                        <span className="text-xs ml-1 text-emerald-400/60 font-bold">ALGO</span>
                                                    </div>
                                                </div>

                                                {/* Release Timer */}
                                                <div className="p-5 bg-gradient-to-br from-violet-950/40 to-slate-950/40 rounded-2xl border border-violet-500/10 hover:border-violet-500/30 transition-all group">
                                                    <div className="text-[10px] text-violet-400/60 font-black mb-3 uppercase tracking-widest flex items-center gap-1.5">
                                                        <Clock className="w-3 h-3" /> Release Timer
                                                    </div>
                                                    <div className="text-2xl font-black text-violet-300 group-hover:text-violet-200 transition-colors">
                                                        {vaultState.lockDuration >= 3600
                                                            ? `${Math.floor(vaultState.lockDuration / 3600)}h ${Math.floor((vaultState.lockDuration % 3600) / 60)}m`
                                                            : `${Math.floor(vaultState.lockDuration / 60)}m ${vaultState.lockDuration % 60}s`
                                                        }
                                                    </div>
                                                </div>

                                                {/* Beneficiary */}
                                                <div className="p-5 bg-gradient-to-br from-blue-950/40 to-slate-950/40 rounded-2xl border border-blue-500/10 hover:border-blue-500/30 transition-all group">
                                                    <div className="text-[10px] text-blue-400/60 font-black mb-3 uppercase tracking-widest flex items-center gap-1.5">
                                                        <ArrowRight className="w-3 h-3" /> Beneficiary
                                                    </div>
                                                    <div className="text-sm font-mono text-blue-300/80 truncate group-hover:text-blue-200 transition-colors" title={vaultState.beneficiary}>
                                                        {vaultState.beneficiary.slice(0, 6)}...{vaultState.beneficiary.slice(-6)}
                                                    </div>
                                                </div>

                                                {/* Owner */}
                                                <div className="p-5 bg-gradient-to-br from-amber-950/40 to-slate-950/40 rounded-2xl border border-amber-500/10 hover:border-amber-500/30 transition-all group">
                                                    <div className="text-[10px] text-amber-400/60 font-black mb-3 uppercase tracking-widest flex items-center gap-1.5">
                                                        <Shield className="w-3 h-3" /> Vault Owner
                                                    </div>
                                                    <div className="text-sm font-mono text-amber-300/80 truncate group-hover:text-amber-200 transition-colors" title={vaultState.owner}>
                                                        {vaultState.owner.slice(0, 6)}...{vaultState.owner.slice(-6)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-32 border border-dashed border-white/10 rounded-[3rem] bg-slate-900/40 backdrop-blur-sm relative overflow-hidden group">
                                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-violet-900/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                <div className="relative z-10 flex flex-col items-center">
                                    <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border border-white/10 group-hover:scale-110 transition-transform duration-300">
                                        <Shield className="w-10 h-10 text-slate-500 group-hover:text-violet-400 transition-colors" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-2">Ready to Secure Assets</h3>
                                    <p className="text-slate-500 text-sm max-w-md mx-auto">Select a vault from the menu or scan the network to find assets linked to your identity.</p>
                                </div>
                            </div>
                        )}

                        {/* Status Display */}
                        {(txId || error) && (
                            <div className={`mt-8 p-4 md:p-6 rounded-2xl text-center font-bold border backdrop-blur-md shadow-2xl animate-in slide-in-from-bottom-4 flex items-center justify-center gap-2 md:gap-3 max-w-full overflow-hidden ${error ? 'bg-red-950/60 border-red-500/30 text-red-200' : 'bg-emerald-950/60 border-emerald-500/30 text-emerald-200'}`}>
                                {error ? <AlertTriangle className="w-5 h-5 md:w-6 md:h-6 flex-shrink-0" /> : <CheckCircle className="w-5 h-5 md:w-6 md:h-6 flex-shrink-0" />}
                                <span className="text-xs md:text-sm break-all min-w-0">{error || txId}</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
