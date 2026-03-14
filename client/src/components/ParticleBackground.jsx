import React from "react";

function ParticleBackground() {
  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      background: "black",
      zIndex: -1
    }}>
      {/* Particle animation will go here later */}
    </div>
  );
}

export default ParticleBackground;
