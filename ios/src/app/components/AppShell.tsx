import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { useAuth } from "../providers/useAuth";
import { getItem, setItem, getProfilePhotoStorageKey } from "../../core/storage/secureStore";
import { canAccessSection, type NavSectionKey } from "../../core/auth/navigation";
import { defaultEmployeePermissions } from "../../core/auth/permissions";

type MenuItem = {
  label: string;
  routeName: string;
  params?: Record<string, unknown>;
  icon: ImageSourcePropType;
  sectionKey: NavSectionKey;
};

const HEADER_HEIGHT = 56;
const menuIcons = {
  home: require("../assets/homelogo.png"),
  approvals: require("../assets/approvalslogo.png"),
  shiftPayout: require("../assets/shiftpayoutlogo.png"),
  team: require("../assets/teamlogo.png"),
  reports: require("../assets/reportslogo.png"),
  profile: require("../assets/settingslogo.png"),
};

const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigation = useNavigation();
  const { session, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [isPickingPhoto, setIsPickingPhoto] = useState(false);
  const insets = useSafeAreaInsets();
  const headerHeight = HEADER_HEIGHT + insets.top;

  const displayName = useMemo(() => {
    const name = session?.userName?.trim() ?? "";
    return name || "User";
  }, [session?.userName]);

  const profilePhotoKey = useMemo(() => {
    const userId = session?.userId ? String(session.userId) : null;
    return userId ? getProfilePhotoStorageKey(userId) : null;
  }, [session?.userId]);

  const restaurantName = session?.restaurantName || "Gratly";

  const menuItems: MenuItem[] = [
    { label: "Home", routeName: "Home", icon: menuIcons.home, sectionKey: "home" },
    { label: "Approvals", routeName: "Approvals", icon: menuIcons.approvals, sectionKey: "approvals" },
    {
      label: "Shift Payout",
      routeName: "ShiftPayout",
      icon: menuIcons.shiftPayout,
      sectionKey: "shift-payout",
    },
    {
      label: "Team",
      routeName: "TeamStack",
      params: { screen: "TeamList" },
      icon: menuIcons.team,
      sectionKey: "team",
    },
    { label: "Reports", routeName: "Reports", icon: menuIcons.reports, sectionKey: "reports" },
    {
      label: "Profile",
      routeName: "SettingsStack",
      params: { screen: "Profile" },
      icon: menuIcons.profile,
      sectionKey: "profile",
    },
  ];

  const permissions = session?.permissions ?? defaultEmployeePermissions;
  const visibleMenuItems = menuItems.filter((item) => canAccessSection(permissions, item.sectionKey));

  useEffect(() => {
    if (!profilePhotoKey) {
      setProfilePhotoUri(null);
      return;
    }
    getItem(profilePhotoKey)
      .then((value) => setProfilePhotoUri(value))
      .catch(() => setProfilePhotoUri(null));
  }, [profilePhotoKey]);

  const saveProfilePhoto = useCallback(
    async (uri: string) => {
      setProfilePhotoUri(uri);
      if (profilePhotoKey) {
        await setItem(profilePhotoKey, uri);
      }
    },
    [profilePhotoKey],
  );

  const handlePickImage = useCallback(
    async (source: "camera" | "library") => {
      if (isPickingPhoto) {
        return;
      }
      setIsPickingPhoto(true);
      try {
        if (source === "camera") {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            Alert.alert("Permission needed", "Enable camera access to take a photo.");
            return;
          }
        } else {
          const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!permission.granted) {
            Alert.alert("Permission needed", "Enable photo access to pick an image.");
            return;
          }
        }

        const result =
          source === "camera"
            ? await ImagePicker.launchCameraAsync({
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
              })
            : await ImagePicker.launchImageLibraryAsync({
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
              });

        if (!result.canceled && result.assets?.[0]?.uri) {
          await saveProfilePhoto(result.assets[0].uri);
        }
      } catch (error) {
        console.warn("Failed to pick image:", error);
      } finally {
        setIsPickingPhoto(false);
      }
    },
    [isPickingPhoto, saveProfilePhoto],
  );

  const handleOpenPhotoMenu = useCallback(() => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancel", "Take Photo", "Choose from Photos"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) {
            void handlePickImage("camera");
          }
          if (buttonIndex === 2) {
            void handlePickImage("library");
          }
        },
      );
      return;
    }
    Alert.alert("Update photo", "Choose an option", [
      { text: "Cancel", style: "cancel" },
      { text: "Take Photo", onPress: () => void handlePickImage("camera") },
      { text: "Choose from Photos", onPress: () => void handlePickImage("library") },
    ]);
  }, [handlePickImage]);

  const getRootNavigation = () => {
    let current = navigation as typeof navigation & { getParent?: () => typeof navigation | undefined };
    while (current.getParent && current.getParent()) {
      current = current.getParent() as typeof navigation & { getParent?: () => typeof navigation | undefined };
    }
    return current;
  };

  const handleNavigate = (item: MenuItem) => {
    const rootNav = getRootNavigation();
    rootNav.navigate(item.routeName as never, item.params as never);
    setMenuOpen(false);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top, height: headerHeight }]}>
        <Pressable
          onPress={() => setMenuOpen((prev) => !prev)}
          style={styles.menuButton}
          accessibilityLabel="Open menu"
        >
          <Ionicons name="menu" size={22} color="#111827" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {restaurantName}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

        <View style={styles.content}>{children}</View>

      <Modal
        transparent
        visible={menuOpen}
        animationType="none"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={[styles.modalRoot, { paddingTop: headerHeight }]} pointerEvents="box-none">
          <View style={styles.menuOverlay}>
            <View style={styles.drawer}>
              <View style={styles.drawerHeader}>
                <View style={styles.closeRow}>
                  <Pressable onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu">
                    <Ionicons name="close" size={22} color="#111827" />
                  </Pressable>
                </View>
                <View style={styles.brandBlock}>
                  <Pressable
                    onPress={handleOpenPhotoMenu}
                    style={styles.avatarCircle}
                    accessibilityLabel="Change profile photo"
                  >
                    {profilePhotoUri ? (
                      <Image source={{ uri: profilePhotoUri }} style={styles.avatarImage} />
                    ) : (
                      <Ionicons name="person-outline" size={24} color="#111827" />
                    )}
                  </Pressable>
                  <Text style={styles.nameText}>{displayName}</Text>
                </View>
              </View>

              <View style={styles.menuList}>
                {visibleMenuItems.map((item) => (
                  <Pressable
                    key={item.label}
                    onPress={() => handleNavigate(item)}
                    style={({ pressed, hovered }) => [
                      styles.menuItem,
                      (pressed || hovered) && styles.menuItemActive,
                    ]}
                  >
                    <Image source={item.icon} style={styles.menuIcon} resizeMode="contain" />
                    <Text style={styles.menuText}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>

          <View style={styles.drawerFooter}>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                void signOut();
              }}
              style={({ pressed, hovered }) => [
                styles.menuItem,
                (pressed || hovered) && styles.menuItemActive,
              ]}
            >
              <Ionicons name="log-out-outline" size={26} color="#111827" style={styles.signOutIcon} />
              <Text style={styles.menuText}>Sign Out</Text>
            </Pressable>
          </View>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f2ee",
  },
  header: {
    height: HEADER_HEIGHT,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    zIndex: 2,
    elevation: 2,
  },
  menuButton: {
    padding: 6,
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#111827",
    fontSize: 16,
    fontWeight: "600",
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    flex: 1,
  },
  modalRoot: {
    flex: 1,
    paddingTop: HEADER_HEIGHT,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "#ffffff",
    zIndex: 3,
    elevation: 3,
  },
  drawer: {
    flex: 1,
    padding: 16,
  },
  drawerHeader: {
    alignItems: "center",
    gap: 10,
  },
  closeRow: {
    alignSelf: "flex-end",
  },
  brandBlock: {
    alignItems: "center",
    marginTop: -18,
  },
  logo: {
    width: 170,
    height: 72,
  },
  avatarCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "#e6d7b8",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: 84,
    height: 84,
    borderRadius: 42,
  },
  nameText: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: "600",
    color: "#374151",
  },
  menuList: {
    marginTop: 28,
    gap: 14,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  menuItemActive: {
    backgroundColor: "#e6d7b8",
  },
  menuIcon: {
    width: 36,
    height: 36,
    marginRight: 18,
  },
  menuText: {
    fontSize: 19,
    color: "#111827",
  },
  signOutIcon: {
    marginRight: 18,
  },
  drawerFooter: {
    marginTop: "auto",
    marginBottom: 16,
  },
});

export default AppShell;
