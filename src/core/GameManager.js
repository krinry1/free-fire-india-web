import * as THREE from 'three';

export class GameManager {
    constructor(scene, uiElements) {
        this.scene = scene;
        this.ui = uiElements;

        // Match State
        this.playerScore = 0;
        this.botScore = 0;
        this.currentRound = 1;
        this.maxRounds = 7;
        this.targetWins = 4;
        this.isMatchOver = false;

        // Spawn Points
        this.playerSpawn = new THREE.Vector3(-15, 0, 40);
        this.botSpawn = new THREE.Vector3(15, 0, -40);

        this.updateScoreUI();
    }

    startRound(player, bot) {
        if (this.isMatchOver) return;

        console.log(`Starting Round ${this.currentRound}`);

        // Reset Player
        if (player) {
            player.reset(this.playerSpawn);
        }

        // Reset Bot
        if (bot) {
            bot.reset(this.botSpawn);
        }

        this.updateScoreUI();
    }

    endRound(winner, player, bot) {
        if (this.isMatchOver) return;

        if (winner === 'player') {
            this.playerScore++;
        } else {
            this.botScore++;
        }

        console.log(`Round ${this.currentRound} ended. Winner: ${winner}`);

        if (this.playerScore >= this.targetWins || this.botScore >= this.targetWins) {
            this.finishMatch();
        } else {
            this.currentRound++;
            // Short delay before next round
            setTimeout(() => {
                this.startRound(player, bot);
            }, 3000);
        }

        this.updateScoreUI();
    }

    updateScoreUI() {
        if (this.ui.scoreText) {
            this.ui.scoreText.innerText = `Round ${this.currentRound} | You: ${this.playerScore} - Bot: ${this.botScore}`;
        }
    }

    finishMatch() {
        this.isMatchOver = true;
        const winnerName = this.playerScore >= this.targetWins ? "YOU WON!" : "BOT WON!";
        console.log(`MATCH OVER: ${winnerName}`);
        
        // Show Match Over UI
        if (this.ui.matchOverOverlay) {
            this.ui.matchOverOverlay.style.display = 'flex';
            this.ui.matchOverText.innerText = winnerName;
        }
    }
}
