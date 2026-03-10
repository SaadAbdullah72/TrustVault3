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
    Zap,
    Copy,
    ExternalLink,
    RefreshCw,
    Send,
    Download,
    Heart,
    ChevronLeft,
    ChevronRight,
    MoreVertical,
    ArrowDownToLine,
    ArrowUpFromLine,
    Eye,
    EyeOff,
    Settings,
    Bell,
    CircleDot,
    CreditCard
} from 'lucide-react'

type TabType = 'overview' | 'card' | 'actions' | 'details'

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

    // Wallet UI state
    const [activeTab, setActiveTab] = useState<TabType>('overview')
    const [showVaultSelector, setShowVaultSelector] = useState(false)
    const [copied, setCopied] = useState(false)
    const [showBalanceHidden, setShowBalanceHidden] = useState(false)

    // Card slider state
    const cardImages = ['/trustvault-card.png', '/trustvault-card-angle.png', '/trustvault-card-back.png']
    const cardLabels = ['Front View', 'Angle View', 'Back View']
    const [cardSlide, setCardSlide] = useState(0)
    const [cardAutoPlay, setCardAutoPlay] = useState(true)

    // Auto-rotate card slider
    useEffect(() => {
        if (!cardAutoPlay) return
        const interval = setInterval(() => {
            setCardSlide(prev => (prev + 1) % cardImages.length)
        }, 3000)
        return () => clearInterval(interval)
    }, [cardAutoPlay, cardImages.length])

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
                if (!state || !state.released) {
                    activeVaults.push(id)
                }
            })

            setUserVaults(activeVaults)
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
            return undefined
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
            const depositMicro = Math.round(parseFloat(depositInput) * 1_000_000)
            const totalNeeded = depositMicro + 500_000
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
            setClaimableVaults(prev => prev.filter(v => v.appId !== vaultAppId))
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

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const formatAddr = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`

    const vaultAddress = selectedAppId ? getAppAddress(selectedAppId) : ''

    // ===== CONNECT SCREEN (Like wallet onboarding) =====
    if (!activeAddress) {
        return (
            <div className="wallet-shell">
                <div className="wallet-container wallet-connect-screen">
                    {/* Gradient orb background */}
                    <div className="connect-orb connect-orb-1" />
                    <div className="connect-orb connect-orb-2" />
                    <div className="connect-orb connect-orb-3" />

                    <div className="connect-content">
                        <div className="connect-logo-wrap">
                            <div className="connect-logo-glow" />
                            <img src="/logo.svg" alt="TrustVault" className="connect-logo-img" />
                        </div>

                        <h1 className="connect-title">TrustVault<sup className="connect-title-sup">3</sup></h1>
                        <p className="connect-subtitle">Autonomous Inheritance Protocol</p>

                        {/* ====== 3D CREDIT CARD SLIDER ====== */}
                        <div className="card-slider-section">
                            <div className="card-slider-stage"
                                onMouseEnter={() => setCardAutoPlay(false)}
                                onMouseLeave={() => setCardAutoPlay(true)}
                            >
                                {/* Nav arrows */}
                                <button className="card-slider-arrow left" onClick={() => setCardSlide(prev => (prev - 1 + cardImages.length) % cardImages.length)}>
                                    <ChevronLeft />
                                </button>
                                <button className="card-slider-arrow right" onClick={() => setCardSlide(prev => (prev + 1) % cardImages.length)}>
                                    <ChevronRight />
                                </button>

                                {/* Card images */}
                                <div className="card-slider-viewport">
                                    <div className="card-slider-glow" />
                                    {cardImages.map((src, idx) => (
                                        <img
                                            key={idx}
                                            src={src}
                                            alt={cardLabels[idx]}
                                            className={`card-slider-img ${idx === cardSlide ? 'active' : idx === (cardSlide - 1 + cardImages.length) % cardImages.length ? 'prev' : idx === (cardSlide + 1) % cardImages.length ? 'next' : 'hidden'}`}
                                        />
                                    ))}
                                </div>

                                {/* Dots */}
                                <div className="card-slider-dots">
                                    {cardImages.map((_, idx) => (
                                        <button
                                            key={idx}
                                            className={`card-slider-dot ${idx === cardSlide ? 'active' : ''}`}
                                            onClick={() => setCardSlide(idx)}
                                        />
                                    ))}
                                </div>
                                <span className="card-slider-label">{cardLabels[cardSlide]}</span>
                            </div>
                            <div className="card-promo-badge">
                                <CreditCard className="card-promo-badge-icon" />
                                <span>Virtual Card Included</span>
                            </div>
                        </div>

                        <div className="connect-features">
                            <div className="connect-feature">
                                <Lock className="connect-feature-icon" />
                                <span>Secure Vaults</span>
                            </div>
                            <div className="connect-feature">
                                <Heart className="connect-feature-icon" />
                                <span>Heartbeat Timer</span>
                            </div>
                            <div className="connect-feature">
                                <Zap className="connect-feature-icon" />
                                <span>Auto Release</span>
                            </div>
                        </div>

                        <button
                            onClick={() => wallets[0]?.connect()}
                            className="connect-btn"
                            disabled={loading}
                        >
                            <Wallet className="connect-btn-icon" />
                            <span>{loading ? 'Connecting...' : 'Connect Wallet'}</span>
                        </button>

                        <p className="connect-footer">
                            Secured by Algorand Blockchain
                        </p>
                    </div>
                </div>
            </div>
        )
    }

    // ===== MAIN WALLET UI =====
    return (
        <div className="wallet-shell">
            <div className="wallet-container">
                {/* ======= TOP NAV BAR ======= */}
                <div className="wallet-topbar">
                    <div className="topbar-left">
                        <div className="topbar-logo">
                            <img src="/logo.svg" alt="TV" className="topbar-logo-img" />
                        </div>
                        <span className="topbar-brand">TrustVault<sup className="topbar-brand-sup">3</sup></span>
                    </div>

                    <div className="topbar-right">
                        {/* Network badge */}
                        <div className="network-badge">
                            <CircleDot className="network-dot" />
                            <span>Testnet</span>
                        </div>
                        <button
                            onClick={() => startDisconnect(wallets.find(w => w.isActive))}
                            className="topbar-disconnect"
                            title="Disconnect"
                        >
                            <LogOut className="topbar-disconnect-icon" />
                        </button>
                    </div>
                </div>

                {/* ======= ACCOUNT HEADER ======= */}
                <div className="wallet-account-header">
                    {/* Vault Selector */}
                    <div className="vault-selector-trigger" onClick={() => setShowVaultSelector(!showVaultSelector)}>
                        <div className="vault-avatar">
                            <Shield className="vault-avatar-icon" />
                        </div>
                        <div className="vault-selector-info">
                            <span className="vault-selector-label">
                                {selectedAppId ? `Vault #${selectedAppId.toString()}` : 'No Vault Selected'}
                            </span>
                            <span className="vault-selector-addr">
                                {vaultAddress ? formatAddr(vaultAddress) : 'Select or create a vault'}
                            </span>
                        </div>
                        <ChevronDown className={`vault-selector-chevron ${showVaultSelector ? 'rotated' : ''}`} />
                    </div>

                    {/* Vault Selector Dropdown */}
                    {showVaultSelector && (
                        <div className="vault-selector-dropdown">
                            <div className="vault-dropdown-header">
                                <span>My Vaults</span>
                                <button onClick={handleScanForClaims} className="vault-dropdown-scan" disabled={loading || discovering}>
                                    <RefreshCw className={`vault-dropdown-scan-icon ${discovering ? 'spinning' : ''}`} />
                                </button>
                            </div>
                            {userVaults.length === 0 && (
                                <div className="vault-dropdown-empty">
                                    <Shield className="vault-dropdown-empty-icon" />
                                    <span>No vaults found</span>
                                </div>
                            )}
                            {userVaults.map(id => (
                                <button
                                    key={id.toString()}
                                    className={`vault-dropdown-item ${selectedAppId === id ? 'active' : ''}`}
                                    onClick={() => { setSelectedAppId(id); setShowVaultSelector(false) }}
                                >
                                    <div className="vault-dropdown-item-avatar">
                                        <Shield className="vault-dropdown-item-icon" />
                                    </div>
                                    <div className="vault-dropdown-item-info">
                                        <span className="vault-dropdown-item-name">Vault #{id.toString()}</span>
                                        <span className="vault-dropdown-item-addr">{formatAddr(getAppAddress(id))}</span>
                                    </div>
                                    {selectedAppId === id && <CheckCircle className="vault-dropdown-item-check" />}
                                </button>
                            ))}
                            <div className="vault-dropdown-actions">
                                <button className="vault-dropdown-action-btn" onClick={() => { setShowCreateForm(true); setShowImportForm(false); setShowVaultSelector(false) }}>
                                    <Plus className="vault-dropdown-action-icon" />
                                    <span>Create Vault</span>
                                </button>
                                <button className="vault-dropdown-action-btn" onClick={() => { setShowImportForm(true); setShowCreateForm(false); setShowVaultSelector(false) }}>
                                    <Download className="vault-dropdown-action-icon" />
                                    <span>Import Vault</span>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Connected Address */}
                    <div className="wallet-address-bar">
                        <div className="wallet-address-dot" />
                        <span className="wallet-address-text">{formatAddr(activeAddress)}</span>
                        <button className="wallet-address-copy" onClick={() => copyToClipboard(activeAddress)} title="Copy Address">
                            {copied ? <CheckCircle className="copy-icon copied" /> : <Copy className="copy-icon" />}
                        </button>
                    </div>
                </div>

                {/* ======= CLAIMABLE VAULTS NOTIFICATION ======= */}
                {claimableVaults.length > 0 && (
                    <div className="claim-notification">
                        <div className="claim-notification-header">
                            <Bell className="claim-bell" />
                            <span className="claim-notification-title">Incoming Inheritance</span>
                            <span className="claim-notification-badge">{claimableVaults.length}</span>
                        </div>
                        {claimableVaults.map((vault) => (
                            <div key={vault.appId.toString()} className="claim-card">
                                <div className="claim-card-info">
                                    <span className="claim-card-id">Vault #{vault.appId.toString()}</span>
                                    <span className="claim-card-status">Timer Expired</span>
                                </div>
                                <button
                                    onClick={() => handleDirectClaim(vault.appId)}
                                    disabled={loading}
                                    className="claim-card-btn"
                                >
                                    <Unlock className="claim-card-btn-icon" />
                                    {loading ? 'Claiming...' : 'Claim'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {scanningClaims && claimableVaults.length === 0 && (
                    <div className="scanning-indicator">
                        <RefreshCw className="scanning-icon spinning" />
                        <span>Scanning for claimable vaults...</span>
                    </div>
                )}

                {/* ======= FORMS (Create / Import) ======= */}
                {showCreateForm && (
                    <div className="wallet-form-overlay">
                        <div className="wallet-form-card">
                            <div className="wallet-form-header">
                                <button onClick={() => setShowCreateForm(false)} className="wallet-form-back">
                                    <ChevronLeft />
                                </button>
                                <span className="wallet-form-title">Create New Vault</span>
                                <div style={{ width: 24 }} />
                            </div>
                            <div className="wallet-form-body">
                                <div className="wallet-input-group">
                                    <label className="wallet-input-label">
                                        <ArrowRight className="wallet-label-icon" />
                                        Beneficiary Address
                                    </label>
                                    <input
                                        value={beneficiaryInput}
                                        onChange={(e) => setBeneficiaryInput(e.target.value)}
                                        className="wallet-input"
                                        placeholder="ALGO address..."
                                    />
                                </div>
                                <div className="wallet-form-row">
                                    <div className="wallet-input-group">
                                        <label className="wallet-input-label">
                                            <Clock className="wallet-label-icon" />
                                            Timer (seconds)
                                        </label>
                                        <input
                                            type="number"
                                            value={lockDurationInput}
                                            onChange={(e) => setLockDurationInput(e.target.value)}
                                            className="wallet-input"
                                        />
                                    </div>
                                    <div className="wallet-input-group">
                                        <label className="wallet-input-label">
                                            <Wallet className="wallet-label-icon" />
                                            Deposit (ALGO)
                                        </label>
                                        <input
                                            type="number"
                                            value={depositInput}
                                            onChange={(e) => setDepositInput(e.target.value)}
                                            className="wallet-input"
                                        />
                                    </div>
                                </div>
                                <button onClick={handleCreateVault} disabled={loading} className="wallet-form-submit">
                                    {loading ? (
                                        <RefreshCw className="spinning submit-icon" />
                                    ) : (
                                        <Shield className="submit-icon" />
                                    )}
                                    <span>{loading ? 'Deploying...' : 'Deploy & Fund Vault'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {showImportForm && (
                    <div className="wallet-form-overlay">
                        <div className="wallet-form-card">
                            <div className="wallet-form-header">
                                <button onClick={() => setShowImportForm(false)} className="wallet-form-back">
                                    <ChevronLeft />
                                </button>
                                <span className="wallet-form-title">Import Vault</span>
                                <div style={{ width: 24 }} />
                            </div>
                            <div className="wallet-form-body">
                                <div className="wallet-input-group">
                                    <label className="wallet-input-label">
                                        <Search className="wallet-label-icon" />
                                        Application ID
                                    </label>
                                    <input
                                        value={importIdInput}
                                        onChange={(e) => setImportIdInput(e.target.value)}
                                        className="wallet-input"
                                        placeholder="Enter App ID..."
                                    />
                                </div>
                                <button onClick={handleImportVault} className="wallet-form-submit">
                                    <Download className="submit-icon" />
                                    <span>Import Vault</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ======= MAIN CONTENT ======= */}
                {discovering ? (
                    <div className="wallet-loading">
                        <div className="wallet-loading-spinner" />
                        <span className="wallet-loading-text">Syncing with blockchain...</span>
                    </div>
                ) : selectedAppId && vaultState ? (
                    <div className="wallet-main-content">
                        {/* ===== BALANCE + STATUS ===== */}
                        <div className="balance-section">
                            <div className="balance-label">
                                <span>Vault Balance</span>
                                <button onClick={() => setShowBalanceHidden(!showBalanceHidden)} className="balance-eye-btn">
                                    {showBalanceHidden ? <EyeOff className="balance-eye-icon" /> : <Eye className="balance-eye-icon" />}
                                </button>
                            </div>
                            <div className="balance-amount">
                                {showBalanceHidden ? '••••••' : vaultBalance.toFixed(4)}
                                <span className="balance-currency">ALGO</span>
                            </div>
                            <div className="role-badges" style={{ justifyContent: 'center', marginTop: 8 }}>
                                {isOwner && (
                                    <div className="role-badge owner">
                                        <Shield className="role-badge-icon" />
                                        <span>Owner</span>
                                    </div>
                                )}
                                {isBeneficiary && (
                                    <div className="role-badge beneficiary">
                                        <Wallet className="role-badge-icon" />
                                        <span>Beneficiary</span>
                                    </div>
                                )}
                                <div className={`vault-status-pill ${vaultState.released ? 'released' : isExpired ? 'expired' : 'secured'}`}>
                                    <div className="status-dot" />
                                    <span>{vaultState.released ? 'Released' : isExpired ? 'Timer Expired' : 'Secured'}</span>
                                </div>
                            </div>
                        </div>

                        {/* ===== QUICK ACTIONS ===== */}
                        <div className="quick-actions">
                            {isOwner && !vaultState.released && (
                                <>
                                    <button className="quick-action-btn" onClick={handleHeartbeat} disabled={loading || isExpired}>
                                        <div className={`quick-action-circle ${isExpired ? 'disabled' : 'heartbeat'}`}>
                                            <Heart className="quick-action-icon" />
                                        </div>
                                        <span className="quick-action-label">Heartbeat</span>
                                    </button>
                                    <button className="quick-action-btn" onClick={handleWithdraw} disabled={loading}>
                                        <div className="quick-action-circle withdraw">
                                            <ArrowUpFromLine className="quick-action-icon" />
                                        </div>
                                        <span className="quick-action-label">Withdraw</span>
                                    </button>
                                </>
                            )}
                            {isBeneficiary && !vaultState.released && (
                                <button className="quick-action-btn" onClick={handleClaim} disabled={loading || !canRelease}>
                                    <div className={`quick-action-circle ${canRelease ? 'claim' : 'disabled'}`}>
                                        <Unlock className="quick-action-icon" />
                                    </div>
                                    <span className="quick-action-label">{canRelease ? 'Claim' : 'Locked'}</span>
                                </button>
                            )}
                            <button className="quick-action-btn" onClick={() => copyToClipboard(vaultAddress)}>
                                <div className="quick-action-circle copy">
                                    <Copy className="quick-action-icon" />
                                </div>
                                <span className="quick-action-label">Copy Addr</span>
                            </button>
                            <button className="quick-action-btn" onClick={handleScanForClaims} disabled={loading}>
                                <div className="quick-action-circle scan">
                                    <Search className="quick-action-icon" />
                                </div>
                                <span className="quick-action-label">Scan</span>
                            </button>
                        </div>

                        {/* ===== CLAIM BANNER ===== */}
                        {isBeneficiary && canRelease && !vaultState.released && (
                            <div className="claim-banner">
                                <div className="claim-banner-left">
                                    <Bell className="claim-bell-icon" />
                                    <div className="claim-banner-text">
                                        <span className="claim-banner-title">Inheritance Ready</span>
                                        <span className="claim-banner-sub">Timer expired — claim your funds</span>
                                    </div>
                                </div>
                                <button className="claim-banner-btn" onClick={handleClaim} disabled={loading}>
                                    {loading ? <RefreshCw className="spinning claim-banner-btn-icon" /> : <Unlock className="claim-banner-btn-icon" />}
                                    <span>Claim Now</span>
                                </button>
                            </div>
                        )}

                        {/* ===== TABS ===== */}
                        <div className="wallet-tabs">
                            <button
                                className={`wallet-tab ${activeTab === 'overview' ? 'active' : ''}`}
                                onClick={() => setActiveTab('overview')}
                            >
                                Overview
                            </button>
                            <button
                                className={`wallet-tab ${activeTab === 'card' ? 'active' : ''}`}
                                onClick={() => setActiveTab('card')}
                            >
                                Card
                            </button>
                            <button
                                className={`wallet-tab ${activeTab === 'actions' ? 'active' : ''}`}
                                onClick={() => setActiveTab('actions')}
                            >
                                Timer
                            </button>
                            <button
                                className={`wallet-tab ${activeTab === 'details' ? 'active' : ''}`}
                                onClick={() => setActiveTab('details')}
                            >
                                Details
                            </button>
                        </div>

                        {/* ===== TAB CONTENT ===== */}
                        <div className="tab-content">
                            {activeTab === 'overview' && (
                                <div className="tab-pane">
                                    <div className="info-list" style={{ marginTop: 8 }}>
                                        <div className="info-row">
                                            <div className="info-row-left">
                                                <div className="info-row-icon-wrap vault-id-icon">
                                                    <Activity className="info-row-icon" />
                                                </div>
                                                <div className="info-row-text">
                                                    <span className="info-row-label">Vault ID</span>
                                                    <span className="info-row-value">#{selectedAppId.toString()}</span>
                                                </div>
                                            </div>
                                            <button className="info-row-action" onClick={() => copyToClipboard(selectedAppId.toString())}>
                                                <Copy className="info-row-action-icon" />
                                            </button>
                                        </div>
                                        <div className="info-row">
                                            <div className="info-row-left">
                                                <div className="info-row-icon-wrap status-icon">
                                                    {vaultState.released ? <Unlock className="info-row-icon" /> : <Lock className="info-row-icon" />}
                                                </div>
                                                <div className="info-row-text">
                                                    <span className="info-row-label">Status</span>
                                                    <span className={`info-row-value ${vaultState.released ? 'text-green' : isExpired ? 'text-red' : 'text-blue'}`}>
                                                        {vaultState.released ? 'Released' : isExpired ? 'Expired — Claimable' : 'Active & Secured'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'card' && (
                                <div className="tab-pane">
                                    <div className="card-tab-showcase">
                                        <div className="card-tab-image-wrap">
                                            <div className="card-tab-reflection" />
                                            <img src="/trustvault-card.png" alt="TrustVault Virtual Card" className="card-tab-image" />
                                        </div>
                                        <div className="card-tab-info">
                                            <div className="card-tab-info-row">
                                                <span className="card-tab-info-label">Card Holder</span>
                                                <span className="card-tab-info-value">{activeAddress ? formatAddr(activeAddress) : '-'}</span>
                                            </div>
                                            <div className="card-tab-info-row">
                                                <span className="card-tab-info-label">Vault ID</span>
                                                <span className="card-tab-info-value">#{selectedAppId?.toString()}</span>
                                            </div>
                                            <div className="card-tab-info-row">
                                                <span className="card-tab-info-label">Current Balance</span>
                                                <span className="card-tab-info-value card-balance">{showBalanceHidden ? '••••' : vaultBalance.toFixed(4)} ALGO</span>
                                            </div>
                                            <div className="card-tab-info-row">
                                                <span className="card-tab-info-label">Card Status</span>
                                                <span className={`card-tab-info-value ${vaultState.released ? 'text-red' : 'text-green'}`}>
                                                    {vaultState.released ? 'Inactive' : 'Active'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'actions' && (
                                <div className="tab-pane">
                                    <div className="countdown-section">
                                        <Countdown lastHeartbeat={vaultState.lastHeartbeat} lockDuration={vaultState.lockDuration} released={vaultState.released} />
                                    </div>
                                </div>
                            )}

                            {activeTab === 'details' && (
                                <div className="tab-pane">
                                    <div className="detail-list">
                                        <div className="detail-item">
                                            <span className="detail-label">Address</span>
                                            <div className="detail-value-row">
                                                <span className="detail-value mono truncate-text">{formatAddr(vaultAddress)}</span>
                                                <button className="detail-copy" onClick={() => copyToClipboard(vaultAddress)}>
                                                    <Copy className="detail-copy-icon" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="detail-item">
                                            <span className="detail-label">Owner</span>
                                            <div className="detail-value-row">
                                                <span className="detail-value mono truncate-text">{formatAddr(vaultState.owner)}</span>
                                                <button className="detail-copy" onClick={() => copyToClipboard(vaultState.owner)}>
                                                    <Copy className="detail-copy-icon" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="detail-item">
                                            <span className="detail-label">Beneficiary</span>
                                            <div className="detail-value-row">
                                                <span className="detail-value mono truncate-text">{formatAddr(vaultState.beneficiary)}</span>
                                                <button className="detail-copy" onClick={() => copyToClipboard(vaultState.beneficiary)}>
                                                    <Copy className="detail-copy-icon" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="detail-item">
                                            <span className="detail-label">Heartbeat</span>
                                            <span className="detail-value">
                                                {new Date(vaultState.lastHeartbeat * 1000).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="detail-item">
                                            <span className="detail-label">Lock Duration</span>
                                            <span className="detail-value">
                                                {vaultState.lockDuration >= 86400
                                                    ? `${Math.floor(vaultState.lockDuration / 86400)}d ${Math.floor((vaultState.lockDuration % 86400) / 3600)}h`
                                                    : vaultState.lockDuration >= 3600
                                                        ? `${Math.floor(vaultState.lockDuration / 3600)}h ${Math.floor((vaultState.lockDuration % 3600) / 60)}m`
                                                        : `${Math.floor(vaultState.lockDuration / 60)}m ${vaultState.lockDuration % 60}s`
                                                }
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* ===== EMPTY STATE ===== */
                    <div className="wallet-empty">
                        <div className="wallet-empty-icon-wrap">
                            <Shield className="wallet-empty-icon" />
                        </div>
                        <h3 className="wallet-empty-title">No Vault Selected</h3>
                        <p className="wallet-empty-desc">Create a new vault or scan the network to find your vaults.</p>
                        <div className="wallet-empty-actions">
                            <button className="wallet-empty-btn primary" onClick={() => setShowCreateForm(true)}>
                                <Plus className="wallet-empty-btn-icon" />
                                Create Vault
                            </button>
                            <button className="wallet-empty-btn secondary" onClick={handleScanForClaims} disabled={loading}>
                                <Search className="wallet-empty-btn-icon" />
                                Scan Network
                            </button>
                        </div>
                    </div>
                )}

                {/* ======= STATUS TOAST ======= */}
                {(txId || error) && (
                    <div className={`wallet-toast ${error ? 'error' : 'success'}`}>
                        {error ? <AlertTriangle className="toast-icon" /> : <CheckCircle className="toast-icon" />}
                        <span className="toast-text">{error || txId}</span>
                        <button className="toast-close" onClick={() => { setError(''); setTxId('') }}>
                            <X className="toast-close-icon" />
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
