import { useEffect, useState } from 'react'

interface CountdownProps {
    lastHeartbeat: number
    lockDuration: number
    released: boolean
}

export default function Countdown({ lastHeartbeat, lockDuration, released }: CountdownProps) {
    const [timeLeft, setTimeLeft] = useState(0)

    useEffect(() => {
        if (released) {
            setTimeLeft(0)
            return
        }

        const updateTimer = () => {
            const now = Math.floor(Date.now() / 1000)
            const unlockTime = lastHeartbeat + lockDuration
            const remaining = unlockTime - now
            setTimeLeft(remaining > 0 ? remaining : 0)
        }

        updateTimer()
        const interval = setInterval(updateTimer, 1000)
        return () => clearInterval(interval)
    }, [lastHeartbeat, lockDuration, released])

    const formatTime = (seconds: number) => {
        const months = Math.floor(seconds / (86400 * 30))
        const remainingAfterMonths = seconds % (86400 * 30)
        const days = Math.floor(remainingAfterMonths / 86400)
        const remainingAfterDays = remainingAfterMonths % 86400
        const hours = Math.floor(remainingAfterDays / 3600)
        const mins = Math.floor((remainingAfterDays % 3600) / 60)
        const secs = remainingAfterDays % 60

        let result = ''
        if (months > 0) result += `${months}mo `
        if (days > 0 || months > 0) result += `${days}d `

        // Always show hours/mins/secs if it's less than a day, or always as part of the total
        result += `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

        return result.trim()
    }

    if (released) {
        return (
            <div className="flex flex-col items-center">
                <div className="text-6xl md:text-8xl font-black text-emerald-400 drop-shadow-[0_0_30px_rgba(52,211,153,0.3)] animate-bounce font-['Outfit']">
                    RELEASED
                </div>
                <div className="mt-4 text-emerald-400/60 font-medium uppercase tracking-[0.2em] text-xs">Assets transmitted to beneficiary</div>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="text-6xl md:text-8xl font-black font-mono tracking-tighter text-white drop-shadow-[0_10px_10px_rgba(0,0,0,0.5)] bg-slate-950/40 py-8 px-4 rounded-3xl border border-slate-800/50">
                {formatTime(timeLeft)}
            </div>
            <div className="flex flex-col items-center gap-2">
                {timeLeft === 0 ? (
                    <div className="flex items-center gap-2 text-rose-500 font-bold animate-pulse">
                        <span className="text-xl">⚠️</span> SECURITY TIMER EXPIRED
                    </div>
                ) : (
                    <div className="flex items-center gap-3 text-slate-500 font-bold text-sm tracking-wide uppercase">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
                        Next Heartbeat deadline approaching
                    </div>
                )}
            </div>
        </div>
    )
}
