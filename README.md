# 🎮 Free Fire India - Web (Source Code)

A high-performance, web-based implementation of a 3D Battle Royale style game using **Three.js** and **Vite**. Features optimized graphics, professional shooting controls, and a custom animation system.

## 🚀 Key Features

- **High Performance:** Capped pixel-ratio, optimized shadow maps, and aggressive culling for smooth FPS on all devices.
- **Professional Controls:** Left-click to fire (with pointer lock), mouse-look exploration, and dedicated sprint keys.
- **Advanced Animation:** Multi-segment character animation blending with upright jump support.
- **Immersive Sound:** Built-in SoundManager for positional weapon fire and footstep effects.
- **Dynamic NPC:** Basic AI system with ground-clamping and health management.

## ⌨️ Controls

| Key | Action |
| --- | --- |
| **W/A/S/D** | Move Player |
| **Mouse** | Aim / Look Around |
| **Left Click** | **FIRE** (Hold to spray) |
| **R** (Hold) | **Sprint Forward** |
| **Space** | Jump |
| **C** | Sit / Crouch |
| **Click** | Lock Pointer to Game |

## 🛠️ Tech Stack

- **Core:** [Three.js](https://threejs.org/) (3D Engine)
- **Physics:** [Cannon-es](https://github.com/pmndrs/cannon-es)
- **Build Tool:** [Vite](https://vitejs.dev/)
- **Models:** Mixamo-compatible GLB models

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/krinry/free-fire-india-web.git

# Enter the directory
cd free-fire-india-web

# Install dependencies
npm install

# Run the development server
npm run dev
```

## 🤝 Contributing

Contributions are welcome! Please check the [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
