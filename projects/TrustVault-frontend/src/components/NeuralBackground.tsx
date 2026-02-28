import { useEffect, useRef } from 'react'

interface Node {
    x: number
    y: number
    vx: number
    vy: number
    radius: number
    brightness: number
    hue: number
}

export default function NeuralBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        let animationId: number
        let nodes: Node[] = []
        let mouse = { x: -999, y: -999 }

        const resize = () => {
            canvas.width = window.innerWidth
            canvas.height = window.innerHeight
            initNodes()
        }

        const initNodes = () => {
            const count = Math.floor((canvas.width * canvas.height) / 8000)
            nodes = Array.from({ length: Math.min(count, 150) }, () => ({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                radius: Math.random() * 2.5 + 1.5,
                brightness: Math.random() * 0.5 + 0.5,
                hue: Math.random() > 0.5 ? 260 : (Math.random() > 0.5 ? 210 : 185) // violet, blue, cyan
            }))
        }

        const connectionDist = 200
        let time = 0

        const draw = () => {
            time += 0.005
            ctx.clearRect(0, 0, canvas.width, canvas.height)

            // Update node positions
            nodes.forEach(node => {
                node.x += node.vx
                node.y += node.vy

                // Gentle boundary bounce
                if (node.x < 0 || node.x > canvas.width) node.vx *= -1
                if (node.y < 0 || node.y > canvas.height) node.vy *= -1
                node.x = Math.max(0, Math.min(canvas.width, node.x))
                node.y = Math.max(0, Math.min(canvas.height, node.y))

                // Pulse brightness
                node.brightness = 0.5 + 0.3 * Math.sin(time * 2 + node.x * 0.01)
            })

            // Draw connections
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const dx = nodes[i].x - nodes[j].x
                    const dy = nodes[i].y - nodes[j].y
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    if (dist < connectionDist) {
                        const opacity = (1 - dist / connectionDist) * 0.25
                        const gradient = ctx.createLinearGradient(
                            nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y
                        )
                        gradient.addColorStop(0, `hsla(${nodes[i].hue}, 80%, 65%, ${opacity})`)
                        gradient.addColorStop(1, `hsla(${nodes[j].hue}, 80%, 65%, ${opacity})`)

                        ctx.beginPath()
                        ctx.moveTo(nodes[i].x, nodes[i].y)
                        ctx.lineTo(nodes[j].x, nodes[j].y)
                        ctx.strokeStyle = gradient
                        ctx.lineWidth = 1
                        ctx.stroke()
                    }
                }
            }

            // Mouse interaction — highlight nearby connections
            const mx = mouse.x, my = mouse.y
            if (mx > 0) {
                nodes.forEach(node => {
                    const dx = node.x - mx
                    const dy = node.y - my
                    const dist = Math.sqrt(dx * dx + dy * dy)
                    if (dist < 250) {
                        const opacity = (1 - dist / 250) * 0.3
                        ctx.beginPath()
                        ctx.moveTo(mx, my)
                        ctx.lineTo(node.x, node.y)
                        ctx.strokeStyle = `hsla(${node.hue}, 90%, 70%, ${opacity})`
                        ctx.lineWidth = 1.5
                        ctx.stroke()
                    }
                })
            }

            // Draw nodes with glow
            nodes.forEach(node => {
                // Outer glow
                const glowGrad = ctx.createRadialGradient(
                    node.x, node.y, 0, node.x, node.y, node.radius * 8
                )
                glowGrad.addColorStop(0, `hsla(${node.hue}, 80%, 65%, ${node.brightness * 0.2})`)
                glowGrad.addColorStop(1, 'transparent')
                ctx.beginPath()
                ctx.arc(node.x, node.y, node.radius * 8, 0, Math.PI * 2)
                ctx.fillStyle = glowGrad
                ctx.fill()

                // Core dot
                ctx.beginPath()
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2)
                ctx.fillStyle = `hsla(${node.hue}, 85%, 70%, ${node.brightness})`
                ctx.fill()

                // Bright center
                ctx.beginPath()
                ctx.arc(node.x, node.y, node.radius * 0.4, 0, Math.PI * 2)
                ctx.fillStyle = `hsla(${node.hue}, 90%, 90%, ${node.brightness * 0.8})`
                ctx.fill()
            })

            animationId = requestAnimationFrame(draw)
        }

        const handleMouse = (e: MouseEvent) => {
            mouse.x = e.clientX
            mouse.y = e.clientY
        }

        resize()
        draw()
        window.addEventListener('resize', resize)
        window.addEventListener('mousemove', handleMouse)

        return () => {
            window.removeEventListener('resize', resize)
            window.removeEventListener('mousemove', handleMouse)
            cancelAnimationFrame(animationId)
        }
    }, [])

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-0 pointer-events-none"
            style={{ background: 'linear-gradient(135deg, #020617 0%, #0a0f1e 40%, #0f0a20 70%, #020617 100%)' }}
        />
    )
}
