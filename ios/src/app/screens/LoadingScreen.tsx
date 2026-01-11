import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

const LoadingScreen = () => (
  <View style={styles.container}>
    <ActivityIndicator size={36} color="#1f2937" />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f4f2ee",
  },
});

export default LoadingScreen;
