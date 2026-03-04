import { Game } from './core/Game.js';

// The main entry point to our application
document.addEventListener('DOMContentLoaded', () => {
    // We bind our game instance to the specified DOM container
    const container = document.getElementById('game-container');
    const loadingScreen = document.getElementById('loading');
    
    // Instantiate our Game object
    const game = new Game(container);

    // Initialize the game environment asynchronously
    game.init().then(() => {
        // Once initialized, hide the loading UI
        if(loadingScreen) loadingScreen.style.display = 'none';

        // Start the game rendering / logic loop
        game.start();
    }).catch(err => {
        console.error("Failed to initialize game:", err);
        if(loadingScreen) loadingScreen.innerText = "Error Loading Map!";
    });
});
