import React, { useEffect, useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import ConnectWallet from './ConnectWallet'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'
import { SnackbarProvider, useSnackbar } from 'notistack'

const TrustVaultApp = () => {
  const { activeAddress, activeWallet, signer } = useWallet()
  const { enqueueSnackbar } = useSnackbar()
  const [openWalletModal, setOpenWalletModal] = useState(false)
  const [appId, setAppId] = useState<number>(parseInt(import.meta.env.VITE_APP_ID) || 0)
  const [contractState, setContractState] = useState<{
    owner: string
    beneficiary: string
    lockDuration: number
    lastHeartbeat: number
    released: boolean
  } | null>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const algodConfig = getAlgodConfigFromViteEnvironment()
  const algodClient = new algosdk.Algodv2(algodConfig.token, algodConfig.server, algodConfig.port)

  const fetchContractState = async () => {
    if (!appId) return
    setLoading(true)
    try {
      const appInfo = await algodClient.getApplicationByID(appId).do()
      // Handle different algosdk versions - check both property names
      const globalState = appInfo.params?.globalState || appInfo.params?.['global-state'] || appInfo['params']?.['global-state']

      if (!globalState) {
        console.error('Could not find global state. App info:', appInfo)
        enqueueSnackbar('Could not read contract state', { variant: 'error' })
        return
      }

      const stateObj: any = {}
      globalState.forEach((item: any) => {
        const key = Buffer.from(item.key, 'base64').toString()
        const value = item.value
        if (value.type === 1) { // Bytes
          stateObj[key] = algosdk.encodeAddress(Buffer.from(value.bytes, 'base64'))
        } else { // Uint
          stateObj[key] = value.uint
        }
      })

      setContractState({
        owner: stateObj['Owner'],
        beneficiary: stateObj['Beneficiary'],
        lockDuration: stateObj['LockDuration'],
        lastHeartbeat: stateObj['LastHeartbeat'],
        released: stateObj['Released'] === 1
      })

    } catch (e) {
      console.error(e)
      enqueueSnackbar('Failed to fetch contract state', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (appId) {
      fetchContractState()
      const interval = setInterval(fetchContractState, 10000) // Refresh every 10s
      return () => clearInterval(interval)
    }
  }, [appId])

  useEffect(() => {
    if (contractState && !contractState.released) {
      const interval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000)
        const unlockTime = contractState.lastHeartbeat + contractState.lockDuration
        const diff = unlockTime - now
        setTimeLeft(diff > 0 ? diff : 0)
      }, 1000)
      return () => clearInterval(interval)
    } else {
      setTimeLeft(0)
    }
  }, [contractState])

  const formatTime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24))
    const h = Math.floor((seconds % (3600 * 24)) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${d}d ${h}h ${m}m ${s}s`
  }

  const handleAutoRelease = async () => {
    if (!activeAddress || !appId) return

    setLoading(true)
    try {
      const atc = new algosdk.AtomicTransactionComposer()
      const suggestedParams = await algodClient.getTransactionParams().do()

      // We need to construct the method call manually or use ABI
      // Since we don't have the ABI TS client generated for this specific setup easily available in frontend yet without running codegen
      // We will use algosdk.Method 

      const method = new algosdk.Method({
        name: "auto_release",
        args: [],
        returns: { type: "void" }
      })

      atc.addMethodCall({
        appID: appId,
        method: method,
        sender: activeAddress,
        signer: signer,
        suggestedParams: suggestedParams,
        methodArgs: []
      })

      const result = await atc.execute(algodClient, 4)
      enqueueSnackbar('Auto Release Triggered!', { variant: 'success' })
      fetchContractState()
    } catch (e: any) {
      console.error(e)
      enqueueSnackbar('Failed to trigger release: ' + e.message, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleDeposit = async () => {
    if (!activeAddress || !appId) return
    setLoading(true)
    try {
      const atc = new algosdk.AtomicTransactionComposer()
      const suggestedParams = await algodClient.getTransactionParams().do()

      const method = new algosdk.Method({
        name: "deposit",
        args: [],
        returns: { type: "void" }
      })

      atc.addMethodCall({
        appID: appId,
        method: method,
        sender: activeAddress,
        signer: signer,
        suggestedParams: suggestedParams,
        methodArgs: []
      })

      await atc.execute(algodClient, 4)
      enqueueSnackbar('Deposit Successful!', { variant: 'success' })
    } catch (e: any) {
      console.error(e)
      enqueueSnackbar('Deposit Failed: ' + e.message, { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-10 border-b border-slate-700 pb-4">
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-blue-500">
            Auto Inheritance Vault (MVP)
          </h1>
          <button
            className="btn btn-outline btn-info gap-2"
            onClick={() => setOpenWalletModal(true)}
          >
            {activeAddress ? activeAddress.slice(0, 8) + '...' : 'Connect Wallet'}
          </button>
        </header>

        <div className="mb-8 p-6 bg-slate-800 rounded-xl shadow-lg border border-slate-700">
          <label className="label">
            <span className="label-text text-slate-300">Application ID</span>
          </label>
          <input
            type="number"
            className="input input-bordered w-full max-w-xs bg-slate-900 text-white"
            placeholder="Enter App ID"
            value={appId || ''}
            onChange={(e) => setAppId(parseInt(e.target.value))}
          />
          <button className="btn btn-primary ml-4" onClick={fetchContractState} disabled={loading || !appId}>
            Load Vault
          </button>
        </div>

        {contractState && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 bg-slate-800 rounded-xl shadow-lg border border-slate-700">
              <h2 className="text-xl font-bold mb-4 text-teal-400">Vault Details</h2>
              <div className="space-y-3">
                <div>
                  <span className="text-sm text-slate-400 block">Owner</span>
                  <span className="font-mono text-xs">{contractState.owner}</span>
                </div>
                <div>
                  <span className="text-sm text-slate-400 block">Beneficiary</span>
                  <span className="font-mono text-xs">{contractState.beneficiary}</span>
                </div>
                <div>
                  <span className="text-sm text-slate-400 block">Status</span>
                  <span className={`badge ${contractState.released ? 'badge-success' : 'badge-warning'}`}>
                    {contractState.released ? 'RELEASED' : 'LOCKED'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-800 rounded-xl shadow-lg border border-slate-700 flex flex-col items-center justify-center text-center">
              {!contractState.released ? (
                <>
                  <div className="text-6xl font-mono font-bold mb-2">
                    {timeLeft !== null ? formatTime(timeLeft) : 'Loading...'}
                  </div>
                  <p className="text-sm text-slate-400 mb-6">Funds will auto-transfer when timer reaches zero</p>

                  {timeLeft === 0 && (
                    <button
                      className="btn btn-error btn-lg w-full"
                      onClick={handleAutoRelease}
                      disabled={loading}
                    >
                      TRIGGER AUTO-RELEASE
                    </button>
                  )}
                  {timeLeft !== 0 && (
                    <div className="alert alert-info">
                      <span>Waiting for heartbeat/timer...</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-success">
                  <h3 className="text-2xl font-bold">Vault Released</h3>
                  <p>Funds have been transferred to the beneficiary.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {contractState && activeAddress === contractState.owner && !contractState.released && (
          <div className="mt-8 p-6 bg-slate-800 rounded-xl border border-teal-900/50">
            <h3 className="text-lg font-bold mb-4">Owner Actions</h3>
            <button className="btn btn-neutral" onClick={handleDeposit} disabled={loading}>
              Signal Liveness / Deposit (Reset Logic Not Implemented in this MVP)
            </button>
            <p className="text-xs text-slate-500 mt-2">Note: In this MVP, Deposit just adds funds and logs event. Real heartbeat logic would reset the timer.</p>
          </div>
        )}
      </div>

      <ConnectWallet openModal={openWalletModal} closeModal={() => setOpenWalletModal(false)} />
    </div>
  )
}

export default TrustVaultApp
