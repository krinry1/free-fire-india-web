import { Game } from './core/Game.js';

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('game-container');
    const loginScreen = document.getElementById('login-screen');
    const lobbyScreen = document.getElementById('lobby-screen');
    const gameUI = document.getElementById('game-ui');
    const loginBtn = document.getElementById('btn-login');
    const startBtn = document.getElementById('btn-start-game');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const loadingStatus = document.getElementById('loading-status');

    // Instantiate game object
    const game = new Game(container);

    // Simulated download progress
    let loadProgress = 0;
    const loadInterval = setInterval(() => {
        loadProgress += Math.random() * 10;
        if (loadProgress >= 100) {
            loadProgress = 100;
            clearInterval(loadInterval);
            finishLoading();
        }
        updateLoadingUI(loadProgress);
    }, 150);

    function updateLoadingUI(progress) {
        if (progressBarFill) progressBarFill.style.width = `${progress}%`;
        if (loadingStatus) loadingStatus.innerText = `Downloading Game Data... ${Math.floor(progress)}%`;
    }

    function finishLoading() {
        if (loadingStatus) loadingStatus.innerText = "Download Complete!";
        if (loginBtn) {
            loginBtn.style.display = 'flex';
            loginBtn.style.opacity = '0';
            setTimeout(() => loginBtn.style.opacity = '1', 50);
        }
        
        // Initialize game in background
        game.init().catch(err => console.error("Game Init Error:", err));
    }

    // Login Action
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            loginScreen.style.opacity = '0';
            setTimeout(() => {
                loginScreen.style.display = 'none';
                if (lobbyScreen) {
                    lobbyScreen.style.display = 'flex';
                    lobbyScreen.style.opacity = '0';
                    setTimeout(() => lobbyScreen.style.opacity = '1', 50);
                }
            }, 500);
            
            if (window.requestFullScreen) window.requestFullScreen();
        });
    }

    // Start Game Action
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            lobbyScreen.style.opacity = '0';
            setTimeout(() => {
                lobbyScreen.style.display = 'none';
                if (container) container.style.display = 'block';
                if (gameUI) gameUI.style.display = 'block';
                
                // Start the actual game loop
                game.start();
            }, 500);

            if (window.requestFullScreen) window.requestFullScreen();
        });
    }
});
