import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";

type NextRoute = {
  label: string;
  screen: string;
  params?: Record<string, string | number | boolean>;
};

type PlaceholderScreenProps = {
  title: string;
  description?: string;
  todos: string[];
  next?: NextRoute;
};

const PlaceholderScreen: React.FC<PlaceholderScreenProps> = ({
  title,
  description,
  todos,
  next,
}) => {
  const navigation = useNavigation();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>TODO</Text>
        {todos.map((item) => (
          <Text key={item} style={styles.todoItem}>
            {`• ${item}`}
          </Text>
        ))}
      </View>
      {next ? (
        <Pressable
          style={styles.button}
          onPress={() =>
            navigation.navigate(next.screen as never, next.params as never)
          }
        >
          <Text style={styles.buttonText}>{next.label}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: "#f4f2ee",
    flexGrow: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
  },
  description: {
    marginTop: 8,
    color: "#6b7280",
  },
  card: {
    marginTop: 16,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    borderColor: "#e5e7eb",
    borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    color: "#6b7280",
    marginBottom: 12,
    fontWeight: "700",
  },
  todoItem: {
    marginBottom: 8,
    color: "#111827",
  },
  button: {
    marginTop: 20,
    backgroundColor: "#cab99a",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  buttonText: {
    color: "#111827",
    fontWeight: "600",
  },
});

export default PlaceholderScreen;
