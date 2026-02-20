import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { getFlagEmoji, getCountryName } from '../utils/countries';
import { useSettings } from '../contexts/SettingsContext';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
    const { settings, updateSetting } = useSettings();

    if (!settings) {
        return <View style={styles.container} />;
    }

    return (
        <View style={styles.container}>
            <StatusBar style="light" />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => navigation.goBack()}
                >
                    <Ionicons name="arrow-back" size={24} color={broadcastTheme.colors.slate200} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Settings</Text>
                <View style={styles.headerSpacer} />
            </View>

            {/* Settings Content */}
            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                {/* SECTION 1: Country */}
                <View style={styles.section}>
                    <Text style={styles.sectionHeader}>Country</Text>

                    <SettingRow
                        title="Set your country"
                        description={`Country set to: ${getFlagEmoji(settings.selectedCountry)} ${getCountryName(settings.selectedCountry)}`}
                        onPress={() => {
                            navigation.navigate('ChooseCountry');
                        }}
                        showChevron
                        isLast
                    />
                </View>

                {/* SECTION 2: Board */}
                <View style={styles.section}>
                    <Text style={styles.sectionHeader}>Board</Text>

                    <SettingRow
                        title="Board Design"
                        description="Choose how the board looks"
                        onPress={() => {
                            navigation.navigate('BoardDesign');
                        }}
                        showChevron
                    />

                    <SettingRow
                        title="Show Coordinates"
                        description="Show board coordinates [a–h][1–8]"
                        rightComponent={
                            <Switch
                                value={settings.showCoordinates}
                                onValueChange={(value) => updateSetting('showCoordinates', value)}
                                trackColor={{
                                    false: broadcastTheme.colors.slate700,
                                    true: broadcastTheme.colors.sky400
                                }}
                                thumbColor={broadcastTheme.colors.slate50}
                            />
                        }
                    />

                    <SettingRow
                        title="New Move Sound"
                        description="Play a sound when a new move arrives"
                        rightComponent={
                            <Switch
                                value={settings.newMoveSound}
                                onValueChange={(value) => updateSetting('newMoveSound', value)}
                                trackColor={{
                                    false: broadcastTheme.colors.slate700,
                                    true: broadcastTheme.colors.sky400
                                }}
                                thumbColor={broadcastTheme.colors.slate50}
                            />
                        }
                        isLast
                    />
                </View>

                {/* SECTION 3: Notifications */}
                <View style={styles.section}>
                    <Text style={styles.sectionHeader}>Notifications</Text>

                    <SettingRow
                        title="New top tournament notifications"
                        description="Get notified about new top tournaments"
                        onPress={() => {
                            updateSetting('newTournamentNotifications', !settings.newTournamentNotifications);
                        }}
                        showChevron
                    />

                    <SettingRow
                        title="Favourite player notifications"
                        description="Get alerts when your favourite player starts or finishes a game"
                        onPress={() => {
                            navigation.navigate('FavouritePlayers');
                        }}
                        showChevron
                    />

                    <SettingRow
                        title="Notification Sounds"
                        description="Turn on/off notification sounds"
                        rightComponent={
                            <Switch
                                value={settings.notificationSounds}
                                onValueChange={(value) => updateSetting('notificationSounds', value)}
                                trackColor={{
                                    false: broadcastTheme.colors.slate700,
                                    true: broadcastTheme.colors.sky400
                                }}
                                thumbColor={broadcastTheme.colors.slate50}
                            />
                        }
                        isLast
                    />
                </View>

                {/* Bottom padding */}
                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
}

interface SettingRowProps {
    title: string;
    description: string;
    rightComponent?: React.ReactNode;
    onPress?: () => void;
    showChevron?: boolean;
    isLast?: boolean;
}

function SettingRow({ title, description, rightComponent, onPress, showChevron, isLast }: SettingRowProps) {
    const content = (
        <View style={[styles.settingRow, isLast && styles.settingRowLast]}>
            <View style={styles.settingTextContainer}>
                <Text style={styles.settingTitle}>{title}</Text>
                <Text style={styles.settingDescription}>{description}</Text>
            </View>
            {rightComponent}
            {showChevron && (
                <Ionicons name="chevron-forward" size={20} color={broadcastTheme.colors.slate400} />
            )}
        </View>
    );

    if (onPress) {
        return (
            <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
                {content}
            </TouchableOpacity>
        );
    }

    return content;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: broadcastTheme.colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: 50,
        paddingBottom: 12,
        paddingHorizontal: 16,
        backgroundColor: broadcastTheme.colors.background,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        flex: 1,
        fontSize: 18,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate50,
        textAlign: 'center',
        marginRight: 40, // Balance the back button
    },
    headerSpacer: {
        width: 40,
    },
    scrollView: {
        flex: 1,
    },
    section: {
        marginTop: 24,
        paddingHorizontal: 16,
    },
    sectionHeader: {
        fontSize: 13,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.amber200,
        marginBottom: 12,
        textTransform: 'capitalize',
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    settingRowLast: {
        borderBottomWidth: 0,
    },
    settingTextContainer: {
        flex: 1,
        marginRight: 12,
    },
    settingTitle: {
        fontSize: 15,
        fontWeight: '500' as '500',
        color: broadcastTheme.colors.slate50,
        marginBottom: 4,
    },
    settingDescription: {
        fontSize: 12,
        color: broadcastTheme.colors.slate400,
        lineHeight: 17,
    },
});
