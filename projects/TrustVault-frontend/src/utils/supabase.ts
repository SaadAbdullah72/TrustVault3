import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Supabase config from environment
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Create client (null if not configured)
let supabase: SupabaseClient | null = null
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    console.log('Supabase connected ✓')
} else {
    console.warn('Supabase not configured — using localStorage fallback for vault discovery')
}

export const isSupabaseConfigured = () => !!supabase

// Save vault-to-beneficiary mapping when a vault is created
export const saveVaultToRegistry = async (
    vaultId: string | bigint,
    beneficiaryAddress: string,
    ownerAddress: string
): Promise<boolean> => {
    if (!supabase) {
        console.warn('Supabase not configured, skipping cloud save')
        return false
    }

    try {
        const { error } = await supabase.from('vault_registry').upsert(
            {
                vault_id: vaultId.toString(),
                beneficiary_address: beneficiaryAddress.toUpperCase(),
                owner_address: ownerAddress.toUpperCase()
            },
            { onConflict: 'vault_id' }
        )

        if (error) {
            console.error('Supabase save error:', error)
            return false
        }

        console.log(`Cloud registry: Saved vault #${vaultId} → ${beneficiaryAddress.slice(0, 8)}...`)
        return true
    } catch (e) {
        console.error('Supabase save failed:', e)
        return false
    }
}

// Get all vault IDs where an address is the beneficiary
export const getVaultsByBeneficiary = async (beneficiaryAddress: string): Promise<string[]> => {
    if (!supabase) return []

    try {
        const { data, error } = await supabase
            .from('vault_registry')
            .select('vault_id')
            .ilike('beneficiary_address', beneficiaryAddress)

        if (error) {
            console.error('Supabase query error:', error)
            return []
        }

        const ids = (data || []).map((row: any) => row.vault_id)
        console.log(`Cloud registry: Found ${ids.length} vault(s) for ${beneficiaryAddress.slice(0, 8)}...`)
        return ids
    } catch (e) {
        console.error('Supabase query failed:', e)
        return []
    }
}

// Get all vault IDs where an address is the owner
export const getVaultsByOwner = async (ownerAddress: string): Promise<string[]> => {
    if (!supabase) return []

    try {
        const { data, error } = await supabase
            .from('vault_registry')
            .select('vault_id')
            .eq('owner_address', ownerAddress.toUpperCase())

        if (error) return []

        return (data || []).map((row: any) => row.vault_id)
    } catch (e) {
        return []
    }
}

export default supabase
