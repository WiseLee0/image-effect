import { useEffect, useRef } from "react";
import FilterComponent from "./filter";
import image1 from "./image1.jpg";
import image2 from "./image2.jpeg";
import BlendComponent from "./blend";

const App = () => {
  useEffect(() => {}, []);
  return (
    <div>
      <div style={{ display: "flex" }}>
        <FilterComponent
          imageURL={image1}
          canvasID="canvas1"
          top={0}
          right={320}
        />
        <div style={{ marginLeft: 20 }}>
          <FilterComponent
            imageURL={image2}
            canvasID="canvas2"
            top={0}
            right={0}
          />
        </div>
      </div>
      <BlendComponent />
    </div>
  );
};

export default App;
