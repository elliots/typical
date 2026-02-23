import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ScrollView,
  Platform,
} from "react-native";

// Types for validation - Typical injects runtime validation automatically
interface User {
  id: number;
  name: `${string}${string}`;
  email: `${string}@${string}.${string}`;
  age?: number;
}

// Typical validates the return type of JSON.parse
function parseUser(json: string): User {
  return JSON.parse(json);
}

// Typical validates function parameters
function formatUser(user: User): string {
  const age = user.age !== undefined ? ` (age: ${user.age})` : "";
  return `${user.name} <${user.email}>${age}`;
}

export default function App() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [age, setAge] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleAddUser = () => {
    setError(null);
    try {
      const parsedAge = age ? Number(age) : undefined;
      const userData = {
        id: Date.now(),
        name: name || null,
        email,
        ...(parsedAge !== undefined ? { age: Number.isNaN(parsedAge) ? age : parsedAge } : {}),
      };
      // Typical validates the parsed JSON matches the User type
      const user = parseUser(JSON.stringify(userData));
      setUsers((prev) => [...prev, user]);
      setName("");
      setEmail("");
      setAge("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Typical + React Native</Text>
      <Text style={styles.subtitle}>Runtime type validation on {Platform.OS}</Text>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Name (required)"
          value={name}
          onChangeText={setName}
          placeholderTextColor="#999"
        />
        <TextInput
          style={styles.input}
          placeholder="Email (must be valid)"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor="#999"
        />
        <TextInput
          style={styles.input}
          placeholder="Age (optional)"
          value={age}
          onChangeText={setAge}
          keyboardType="numeric"
          placeholderTextColor="#999"
        />
        <TouchableOpacity style={styles.button} onPress={handleAddUser}>
          <Text style={styles.buttonText}>Add User</Text>
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Users ({users.length})</Text>
      {users.length === 0 ? (
        <Text style={styles.emptyText}>
          No users yet. Try adding one with an invalid email to see validation!
        </Text>
      ) : (
        users.map((user: User, idx: number) => (
          <View key={`${user.id}-${idx}`} style={styles.userCard}>
            <Text style={styles.userName}>{formatUser(user)}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 60,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 24,
  },
  form: {
    gap: 12,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#007AFF",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  errorBox: {
    backgroundColor: "#FEE",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: "#C00",
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
  },
  emptyText: {
    color: "#999",
    fontSize: 14,
  },
  userCard: {
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  userName: {
    fontSize: 15,
  },
});
