interface VaultStatusProps {
    released: boolean
}

export default function VaultStatus({ released }: VaultStatusProps) {
    return (
        <div className={`
            inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest uppercase shadow-lg transition-all border
            ${released
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-500 border-amber-500/30 animate-pulse'
            }
        `}>
            <div className={`w-2 h-2 rounded-full ${released ? 'bg-emerald-400' : 'bg-amber-500'}`} />
            {released ? 'Assets Released' : 'Vault Secured'}
        </div>
    )
}
