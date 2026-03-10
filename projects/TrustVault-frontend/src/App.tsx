import { NetworkId, WalletId, WalletManager, WalletProvider } from '@txnlab/use-wallet-react'
import { SnackbarProvider } from 'notistack'
import VaultPage from './pages/VaultPage'

// Configure wallet manager
const walletManager = new WalletManager({
  wallets: [
    WalletId.PERA,
    WalletId.DEFLY,
    WalletId.EXODUS
  ],
  defaultNetwork: NetworkId.TESTNET,
  networks: {
    [NetworkId.TESTNET]: {
      algod: {
        baseServer: 'https://testnet-api.algonode.cloud',
        port: '',
        token: ''
      }
    }
  }
})

export default function App() {
  return (
    <WalletProvider manager={walletManager}>
      <SnackbarProvider maxSnack={3}>
        <VaultPage />
      </SnackbarProvider>
    </WalletProvider>
  )
}
