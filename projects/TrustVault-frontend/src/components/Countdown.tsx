import { useEffect, useState } from 'react'
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react'

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

    const total = lockDuration
    const elapsed = total - timeLeft
    const progress = total > 0 ? Math.min((elapsed / total) * 100, 100) : 100

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
        result += `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        return result.trim()
    }

    // Circular progress SVG params
    const size = 160
    const strokeWidth = 6
    const radius = (size - strokeWidth) / 2
    const circumference = 2 * Math.PI * radius
    const strokeDashoffset = circumference - (progress / 100) * circumference

    if (released) {
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
                padding: '20px 0'
            }}>
                <div style={{
                    width: size, height: size, position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
                            stroke="rgba(16,185,129,0.1)" strokeWidth={strokeWidth} />
                        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
                            stroke="#10b981" strokeWidth={strokeWidth}
                            strokeDasharray={circumference} strokeDashoffset={0}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 1s ease' }} />
                    </svg>
                    <div style={{
                        position: 'absolute', display: 'flex', flexDirection: 'column',
                        alignItems: 'center', gap: '4px'
                    }}>
                        <CheckCircle style={{ width: 28, height: 28, color: '#10b981' }} />
                        <span style={{
                            fontSize: '16px', fontWeight: 800, color: '#10b981',
                            letterSpacing: '1px'
                        }}>RELEASED</span>
                    </div>
                </div>
                <span style={{
                    fontSize: '11px', color: '#64748b', fontWeight: 500,
                    letterSpacing: '0.5px'
                }}>Assets transmitted to beneficiary</span>
            </div>
        )
    }

    const isExpired = timeLeft === 0
    const accentColor = isExpired ? '#ef4444' : '#14b8a6'

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
            padding: '20px 0'
        }}>
            <div style={{
                width: size, height: size, position: 'relative',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
                <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
                        stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
                    <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
                        stroke={accentColor} strokeWidth={strokeWidth}
                        strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        style={{ transition: 'stroke-dashoffset 1s ease', filter: `drop-shadow(0 0 6px ${accentColor}50)` }} />
                </svg>
                <div style={{
                    position: 'absolute', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: '2px'
                }}>
                    <span style={{
                        fontSize: '10px', color: '#64748b', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '1px'
                    }}>{isExpired ? 'Expired' : 'Time Left'}</span>
                    <span style={{
                        fontSize: '22px', fontWeight: 900, fontFamily: "'Inter', monospace",
                        color: isExpired ? '#ef4444' : '#f1f5f9',
                        letterSpacing: '-0.5px'
                    }}>{formatTime(timeLeft)}</span>
                </div>
            </div>

            <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                fontSize: '12px', fontWeight: 600
            }}>
                {isExpired ? (
                    <>
                        <AlertTriangle style={{ width: 14, height: 14, color: '#ef4444' }} />
                        <span style={{ color: '#ef4444' }}>Security timer expired — vault is claimable</span>
                    </>
                ) : (
                    <>
                        <Clock style={{ width: 14, height: 14, color: '#3b82f6' }} />
                        <span style={{ color: '#94a3b8' }}>Heartbeat deadline approaching</span>
                    </>
                )}
            </div>
        </div>
    )
}
