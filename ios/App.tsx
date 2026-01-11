import "react-native-gesture-handler";

if (process.env.EXPO_PUBLIC_ENABLE_FABRIC_PATCH === "1") {
  try {
    // Optional runtime patch; keep guarded to avoid native crashes.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("./src/app/patches/patchFabricProps");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[fabric-prop-normalize] patch load failed", error);
  }
}
import App from "./src/app/App";

export default App;
