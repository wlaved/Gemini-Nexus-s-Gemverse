// --- GEMVERSE PHYSICS WORKER V2.8 ---
// This entire script runs on a separate thread to handle all heavy calculations.
// It imports the Cannon.js physics library to do its work.

importScripts('https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.iife.min.js');

let player, physicsWorld, playerBody;
const keys = {};
const WORLD_SIZE = 50;
const GRAVITY_STRENGTH = 30;

self.onmessage = (e) => {
    const { type, data } = e.data;
    switch(type) {
        case 'init':
            player = data.player;
            initPhysics(data.world);
            setInterval(update, 1000 / 60);
            break;
        case 'input': 
            keys[data.key] = data.pressed; 
            if (keys['shift'] && (keys['w'] || keys['a'] || keys['s'] || keys['d'] || keys[' '])) {
                forceJump();
            }
            break;
        case 'mousemove': 
            player.yaw -= data.movementX * 0.002;
            player.pitch -= data.movementY * 0.002;
            player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
            break;
    }
};

function initPhysics(worldData) {
    physicsWorld = new CANNON.World({
        gravity: new CANNON.Vec3(0, -GRAVITY_STRENGTH, 0),
    });
    
    playerBody = new CANNON.Body({
        mass: 5,
        position: new CANNON.Vec3(player.position.x, player.position.y, player.position.z),
        shape: new CANNON.Box(new CANNON.Vec3(player.width/2, player.height/2, player.width/2)),
        fixedRotation: true, // Prevents the physics engine from making the player fall over
    });
    physicsWorld.addBody(playerBody);

    // Create static bodies for all the world blocks
    for (const block of worldData) {
        const pos = block.key.split(',').map(Number);
        const body = new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
            position: new CANNON.Vec3(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5)
        });
        physicsWorld.addBody(body);
    }
}

function update() {
    const deltaTime = 1 / 60;
    
    if (!player.isForceJumping) {
        handleBoxGravity();
        handleMovement(deltaTime);
    }
    
    physicsWorld.step(deltaTime);
    
    // Check for ground contact after physics step
    checkOnGround();

    // Send the final, calculated state back to the main thread
    self.postMessage({ 
        type: 'state_update', 
        position: playerBody.position, 
        quaternion: playerBody.quaternion, // The physics body's orientation
        onGround: player.onGround
    });
}

function handleBoxGravity() {
    const p = playerBody.position;
    const distances = [
        { face: 'Y-', dist: p.y }, { face: 'Y+', dist: WORLD_SIZE - p.y },
        { face: 'X-', dist: p.x }, { face: 'X+', dist: WORLD_SIZE - p.x },
        { face: 'Z-', dist: p.z }, { face: 'Z+', dist: WORLD_SIZE - p.z },
    ];
    distances.sort((a, b) => a.dist - b.dist);
    const currentFace = distances[0].face;
    
    let targetUp = new CANNON.Vec3(0, 1, 0);
    switch(currentFace) {
        case 'Y+': physicsWorld.gravity.set(0, GRAVITY_STRENGTH, 0); targetUp.set(0, -1, 0); break;
        case 'X-': physicsWorld.gravity.set(-GRAVITY_STRENGTH, 0, 0); targetUp.set(1, 0, 0); break;
        case 'X+': physicsWorld.gravity.set(GRAVITY_STRENGTH, 0, 0); targetUp.set(-1, 0, 0); break;
        case 'Z-': physicsWorld.gravity.set(0, 0, -GRAVITY_STRENGTH); targetUp.set(0, 0, 1); break;
        case 'Z+': physicsWorld.gravity.set(0, 0, GRAVITY_STRENGTH); targetUp.set(0, 0, -1); break;
        default: physicsWorld.gravity.set(0, -GRAVITY_STRENGTH, 0); targetUp.set(0, 1, 0); break;
    }
    
    // Smoothly rotate the player's body to align with the new 'up'
    const currentUp = new CANNON.Vec3(0, 1, 0);
    playerBody.quaternion.vmult(currentUp, currentUp);
    const rotation = new CANNON.Quaternion();
    rotation.setFromVectors(currentUp, targetUp);
    playerBody.quaternion.mult(rotation, playerBody.quaternion);
}

function handleMovement(deltaTime) {
    const speed = 5.0;
    const lookQuaternion = new CANNON.Quaternion().setFromEuler(player.pitch, player.yaw, 0, 'YXZ');
    const finalQuaternion = playerBody.quaternion.mult(lookQuaternion);
    
    const forward = new CANNON.Vec3(0, 0, -1);
    finalQuaternion.vmult(forward, forward);
    const right = new CANNON.Vec3(1, 0, 0);
    finalQuaternion.vmult(right, right);

    let moveDirection = new CANNON.Vec3(0,0,0);
    if (keys['w']) moveDirection.vadd(forward, moveDirection);
    if (keys['s']) moveDirection.vsub(forward, moveDirection);
    if (keys['a']) moveDirection.vsub(right, moveDirection);
    if (keys['d']) moveDirection.vadd(right, moveDirection);

    if (moveDirection.lengthSquared() > 0) {
        moveDirection.normalize();
        const currentVelocityOnPlane = new CANNON.Vec3();
        playerBody.velocity.projectOnPlane(player.up, currentVelocityOnPlane);
        
        const newVelocity = new CANNON.Vec3();
        moveDirection.scale(speed, newVelocity);
        
        // Preserve gravity's effect on velocity
        const verticalVelocity = playerBody.velocity.dot(player.up);
        const verticalVector = new CANNON.Vec3();
        player.up.scale(verticalVelocity, verticalVector);

        playerBody.velocity.copy(newVelocity).vadd(verticalVector, playerBody.velocity);
    }
    
    if (keys[' '] && player.onGround) {
        playerBody.velocity.vadd(player.up.scale(8), playerBody.velocity);
    }
}

function checkOnGround() {
    const from = playerBody.position;
    const to = new CANNON.Vec3();
    player.up.scale(-player.height/2 - 0.1, to);
    to.vadd(from, to);
    const result = new CANNON.RaycastResult();
    physicsWorld.raycastClosest(from, to, {}, result);
    player.onGround = result.hasHit;
}

function forceJump() {
    // Force jump logic would be complex with a real physics engine.
    // For now, this is a placeholder. We will revisit this epic feature.
    console.log("Force jump initiated (placeholder)");
}

