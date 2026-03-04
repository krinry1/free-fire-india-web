import * as CANNON from 'cannon-es';

/**
 * Physics Class
 * Wraps the Cannon-es simulated world for gravity and collisions.
 */
export class Physics {
    constructor() {
        // 1. Initialize the Cannon physics world
        this.world = new CANNON.World();

        // Use a standard gravity value (Earth is approx -9.81 m/s^2)
        // Vector3 is (x, y, z) - we want gravity to pull straight down on the Y axis
        this.world.gravity.set(0, -9.81, 0);

        // Optional: Set broadphase for better performance (sweeping for collisions efficiently)
        this.world.broadphase = new CANNON.SAPBroadphase(this.world);

        // 2. Create the static ground plane
        this.createGround();
    }

    /**
     * Initializes an infinite, invisible static plane so objects don't fall forever.
     */
    createGround() {
        // Create a perfect flat plane shape in Cannon-es
        // Note: Cannon's plane extends infinitely in all horizontal directions.
        const groundShape = new CANNON.Plane();

        // Define the physics body properties
        const groundBody = new CANNON.Body({
            mass: 0, // IMPORTANT: A mass of 0 makes the body completely static (it will not move from gravity or collisions)
            shape: groundShape
        });

        // By default, Cannon's plane faces the positive Z-axis. 
        // We need it to face the positive Y-axis (upward) like our Three.js floor,
        // so we rotate it by -90 degrees around the X-axis.
        groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);

        // Add the invisible ground to the physics world
        this.world.addBody(groundBody);
    }

    /**
     * Steps the physics simulation forward.
     * @param {number} delta - The time elapsed since the last frame (in seconds)
     */
    update(delta) {
        // Cannon-es expects a fixed time slice (e.g., 1/60th of a second).
        // Passing the actual delta, plus fallback values, helps handle variable framerates smoothly.
        // parameters: (fixedTimeStep, deltaTime, maxSubSteps)
        this.world.step(1 / 60, delta, 3);
    }
}
