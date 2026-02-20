import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

const PlaceholderScreen = ({ title }: { title: string }) => {
    const navigation = useNavigation();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Ionicons name="arrow-back" size={24} color={broadcastTheme.colors.slate200} />
                </TouchableOpacity>
                <Text style={styles.title}>{title}</Text>
            </View>
            <View style={styles.content}>
                <Ionicons name="construct-outline" size={64} color={broadcastTheme.colors.slate700} />
                <Text style={styles.subtitle}>Coming Soon</Text>
            </View>
        </SafeAreaView>
    );
};

export const TopPlayersScreen = () => <PlaceholderScreen title="Top Players" />;
export const ContactScreen = () => <PlaceholderScreen title="Contact Us" />;
export const OrganizerScreen = () => <PlaceholderScreen title="Organizer" />;

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: broadcastTheme.colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: broadcastTheme.colors.borderDefault,
    },
    backButton: {
        marginRight: 16,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: broadcastTheme.colors.slate50,
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    subtitle: {
        fontSize: 16,
        color: broadcastTheme.colors.slate400,
        marginTop: 16,
    },
});
