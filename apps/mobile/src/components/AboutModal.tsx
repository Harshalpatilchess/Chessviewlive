import { Modal, View, Text, StyleSheet, TouchableOpacity, Pressable, Alert, Clipboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';

interface AboutModalProps {
    visible: boolean;
    onClose: () => void;
    onFeedback: () => void;
}

export default function AboutModal({ visible, onClose, onFeedback }: AboutModalProps) {
    const handleEmailPress = () => {
        Clipboard.setString('Harshalp1236@gmail.com');
        Alert.alert('Copied', 'Email address copied to clipboard');
    };

    const handleRate = () => {
        // Placeholder for app store rating - show polite message for now
        Alert.alert('Rating coming soon', 'App store integration will be available soon!');
    };

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={styles.overlay} onPress={onClose}>
                <Pressable style={styles.container} onPress={(e) => e.stopPropagation()}>
                    {/* Header - minimal, no divider */}
                    <View style={styles.header}>
                        <Text style={styles.title}>About</Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeIconButton}>
                            <Ionicons name="close" size={22} color={broadcastTheme.colors.slate400} />
                        </TouchableOpacity>
                    </View>

                    {/* Content */}
                    <View style={styles.content}>
                        <Text style={styles.appName}>ChessView Live</Text>
                        <Text style={styles.byLine}>by Harshal Patil</Text>

                        {/* Email row - elegant pill */}
                        <TouchableOpacity
                            style={styles.emailPill}
                            onPress={handleEmailPress}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="mail-outline" size={16} color={broadcastTheme.colors.sky400} />
                            <Text style={styles.email}>Harshalp1236@gmail.com</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Action Buttons - clear hierarchy */}
                    <View style={styles.actions}>
                        {/* Rate - Secondary (outline) */}
                        <TouchableOpacity
                            style={styles.secondaryButton}
                            onPress={handleRate}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="star-outline" size={16} color={broadcastTheme.colors.slate300} />
                            <Text style={styles.secondaryButtonText}>Rate</Text>
                        </TouchableOpacity>

                        {/* Feedback - Primary (filled) */}
                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => {
                                onClose();
                                onFeedback();
                            }}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="chatbubble-outline" size={16} color={broadcastTheme.colors.slate950} />
                            <Text style={styles.primaryButtonText}>Feedback</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Close - Ghost/text button at bottom */}
                    <TouchableOpacity
                        style={styles.closeButton}
                        onPress={onClose}
                        activeOpacity={0.6}
                    >
                        <Text style={styles.closeButtonText}>Close</Text>
                    </TouchableOpacity>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    container: {
        backgroundColor: 'rgba(15, 23, 42, 0.95)', // Glass-like dark card
        borderRadius: 24, // Larger, more modern radius
        borderWidth: 1,
        borderColor: 'rgba(71, 85, 105, 0.3)', // Subtle border
        width: '100%',
        maxWidth: 360, // Slightly smaller
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.5,
        shadowRadius: 24,
        elevation: 16,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 16, // No divider, just spacing
    },
    title: {
        fontSize: 18,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate50,
    },
    closeIconButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
    },
    content: {
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 24,
        alignItems: 'center',
    },
    appName: {
        fontSize: 26,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate50,
        marginBottom: 6,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    byLine: {
        fontSize: 14,
        color: broadcastTheme.colors.slate400,
        marginBottom: 20,
        textAlign: 'center',
    },
    emailPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(2, 6, 23, 0.6)', // Subtle, not chunky
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 20, // Pill shape
        borderWidth: 1,
        borderColor: 'rgba(71, 85, 105, 0.25)',
    },
    email: {
        fontSize: 13,
        color: broadcastTheme.colors.sky400,
        fontWeight: '500' as '500',
    },
    actions: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 24,
        paddingBottom: 16,
    },
    // Primary button (Feedback) - filled
    primaryButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: broadcastTheme.colors.sky400,
        paddingVertical: 13,
        borderRadius: 12,
        shadowColor: broadcastTheme.colors.sky400,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 3,
    },
    primaryButtonText: {
        fontSize: 15,
        fontWeight: '700' as '700',
        color: broadcastTheme.colors.slate950,
    },
    // Secondary button (Rate) - outline
    secondaryButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: 'transparent',
        paddingVertical: 13,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: broadcastTheme.colors.borderDefault,
    },
    secondaryButtonText: {
        fontSize: 15,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate300,
    },
    // Close button - ghost/text style
    closeButton: {
        paddingVertical: 14,
        paddingHorizontal: 24,
        alignItems: 'center',
        marginBottom: 8,
    },
    closeButtonText: {
        fontSize: 14,
        fontWeight: '600' as '600',
        color: broadcastTheme.colors.slate400,
    },
});
