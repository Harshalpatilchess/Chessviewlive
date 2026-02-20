import React, { useRef, useEffect } from 'react';
import { StyleSheet, Text, View, Modal, Pressable, Animated, Dimensions, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import { useNavigation, useRoute, CommonActions } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

/*
Structure:
A) Top section (Tournaments)
- All Tournaments
- Current Tournaments
- Past Tournaments
- Upcoming Tournaments (NEW)

B) Middle section
- Favorites
- Top Players

C) Bottom section
- Contact
- Organizer
*/

const { width } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.60;
const ANIMATION_DURATION = 250;

interface SidebarProps {
    visible: boolean;
    onClose: () => void;
}

export default function Sidebar({ visible, onClose }: SidebarProps) {
    const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const navigation = useNavigation<any>();
    const route = useRoute<any>();

    // Open Animation
    useEffect(() => {
        if (visible) {
            Animated.parallel([
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: ANIMATION_DURATION,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            // Close Animation logic handled in handleClose to allow animation before unmount
        }
    }, [visible]);

    const handleClose = () => {
        Animated.parallel([
            Animated.timing(slideAnim, {
                toValue: -DRAWER_WIDTH,
                duration: ANIMATION_DURATION,
                useNativeDriver: true,
            }),
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: ANIMATION_DURATION,
                useNativeDriver: true,
            }),
        ]).start(() => {
            onClose();
        });
    };

    const navigateToTournaments = (filter: 'ALL' | 'ONGOING' | 'FINISHED' | 'UPCOMING') => {
        // Close drawer first
        handleClose();

        // Use timeout to allow drawer to close smoothy
        setTimeout(() => {
            // Reset to Tournaments screen with params
            navigation.dispatch(
                CommonActions.reset({
                    index: 0,
                    routes: [
                        { name: 'Tournaments', params: { filter } },
                    ],
                })
            );
        }, 100);
    };

    const navigateToScreen = (screenName: string) => {
        handleClose();
        setTimeout(() => {
            navigation.navigate(screenName);
        }, 100);
    };

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            transparent={true}
            onRequestClose={handleClose}
            statusBarTranslucent
        >
            <View style={styles.container}>
                {/* Backdrop */}
                <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
                    <Pressable style={styles.backdropPressable} onPress={handleClose} />
                </Animated.View>

                {/* Drawer Content */}
                <Animated.View style={[styles.drawer, { transform: [{ translateX: slideAnim }] }]}>
                    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
                        {/* Header */}
                        <View style={styles.header}>
                            <Text style={styles.headerTitle}>Menu</Text>
                            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                                <Ionicons name="close" size={24} color={broadcastTheme.colors.slate300} />
                            </TouchableOpacity>
                        </View>

                        {/* Menu Body - Fixed Layout */}
                        <View style={styles.menuBody}>
                            {/* TOP Section: Tournaments (Pinned Top) */}
                            <View style={styles.topSection}>
                                <Text style={styles.sectionTitle}>Tournaments</Text>
                                <DrawerItem
                                    label="All tournaments"
                                    icon="globe-outline"
                                    onPress={() => navigateToTournaments('ALL')}
                                />
                                <DrawerItem
                                    label="Ongoing"
                                    icon="play-circle-outline"
                                    onPress={() => navigateToTournaments('ONGOING')}
                                />
                                <DrawerItem
                                    label="Completed"
                                    icon="time-outline"
                                    onPress={() => navigateToTournaments('FINISHED')}
                                />
                                <DrawerItem
                                    label="Coming Up"
                                    icon="calendar-outline"
                                    onPress={() => navigateToTournaments('UPCOMING')}
                                />
                            </View>

                            {/* MIDDLE Section: Favorites & Top Players (Centered) */}
                            <View style={styles.middleSection}>
                                <DrawerItem
                                    label="Saved Games"
                                    icon="bookmark-outline"
                                    onPress={() => navigateToScreen('FavouritePlayers')}
                                />
                                <DrawerItem
                                    label="Top Players"
                                    icon="people-outline"
                                    onPress={() => navigateToScreen('TopPlayers')}
                                />
                            </View>

                            {/* BOTTOM Section: Contact & Organizer (Pinned Bottom) */}
                            <View style={styles.bottomSection}>
                                <DrawerItem
                                    label="Contact"
                                    icon="chatbubble-ellipses-outline"
                                    onPress={() => navigateToScreen('Contact')}
                                />
                                <DrawerItem
                                    label="Organizer"
                                    icon="briefcase-outline"
                                    onPress={() => navigateToScreen('Organizer')}
                                />
                            </View>
                        </View>

                    </SafeAreaView>
                </Animated.View>
            </View>
        </Modal>
    );
}

const DrawerItem = ({ label, icon, onPress }: { label: string, icon: keyof typeof Ionicons.glyphMap, onPress: () => void }) => (
    <TouchableOpacity style={styles.item} onPress={onPress}>
        <Ionicons name={icon} size={22} color={broadcastTheme.colors.slate400} style={styles.itemIcon} />
        <Text style={styles.itemLabel}>{label}</Text>
    </TouchableOpacity>
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.6)',
    },
    backdropPressable: {
        flex: 1,
    },
    drawer: {
        width: DRAWER_WIDTH,
        backgroundColor: broadcastTheme.colors.background,
        height: '100%',
        borderRightWidth: 1,
        borderRightColor: broadcastTheme.colors.borderDefault,
    },
    safeArea: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12, // Reduced from 20
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
        zIndex: 10,
        backgroundColor: broadcastTheme.colors.background, // Ensure opaque coverage
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: broadcastTheme.colors.slate50,
    },
    closeButton: {
        padding: 4,
    },
    menuBody: {
        flex: 1,
        position: 'relative',
    },
    topSection: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        paddingTop: 16,
    },
    middleSection: {
        flex: 1,
        justifyContent: 'center',
    },
    bottomSection: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 20, // Add some bottom padding
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '400',
        color: broadcastTheme.colors.slate300,
        opacity: 0.8,
        marginBottom: 8,
        paddingHorizontal: 16, // Reduced from 20, slightly indented
        textTransform: 'none', // Remove ALL CAPS
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12, // Reduced from 20
    },
    itemIcon: {
        marginRight: 16,
    },
    itemLabel: {
        fontSize: 16,
        color: broadcastTheme.colors.slate200,
        fontWeight: '500',
        flex: 1,
    },
    // Search styles
    searchableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingRight: 20, // Padding for the right search icon
    },
    searchIconButton: {
        padding: 8,
        marginRight: -8, // Hit area adjustment
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(2, 6, 23, 0.4)', // Slightly darker background for input
        marginHorizontal: 16,
        marginVertical: 4,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        height: 40,
    },
    searchInput: {
        flex: 1,
        color: broadcastTheme.colors.slate50,
        fontSize: 14,
        paddingHorizontal: 8,
        height: '100%',
    },
    searchCloseButton: {
        padding: 8,
    },
});
