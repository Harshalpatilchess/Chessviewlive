import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, FlatList, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { broadcastTheme } from '../theme/broadcastTheme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useState, useEffect } from 'react';
import { COUNTRIES, getFlagEmoji, type Country } from '../utils/countries';
import { getSettings, saveSettings } from '../utils/settingsStorage';

type Props = NativeStackScreenProps<RootStackParamList, 'ChooseCountry'>;

export default function ChooseCountryScreen({ navigation }: Props) {
    const [selectedCountryCode, setSelectedCountryCode] = useState<string>('IN');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        loadCurrentCountry();
    }, []);

    const loadCurrentCountry = async () => {
        const settings = await getSettings();
        setSelectedCountryCode(settings.selectedCountry || 'IN');
    };

    const selectCountry = async (countryCode: string) => {
        await saveSettings({ selectedCountry: countryCode });
        navigation.goBack();
    };

    // Filter countries based on search
    const filteredCountries = searchQuery.trim()
        ? COUNTRIES.filter(country =>
            country.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : COUNTRIES;

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
                <Text style={styles.headerTitle}>Choose Your Country</Text>
                <View style={styles.headerSpacer} />
            </View>

            {/* Search Input */}
            <View style={styles.searchContainer}>
                <Ionicons name="search" size={18} color={broadcastTheme.colors.slate400} style={styles.searchIcon} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search countries..."
                    placeholderTextColor={broadcastTheme.colors.slate400}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                />
                {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={18} color={broadcastTheme.colors.slate400} />
                    </TouchableOpacity>
                )}
            </View>

            {/* Country List */}
            <FlatList
                data={filteredCountries}
                keyExtractor={(item) => item.code}
                renderItem={({ item }) => {
                    const isSelected = item.code === selectedCountryCode;
                    const flag = getFlagEmoji(item.code);

                    return (
                        <TouchableOpacity
                            style={styles.countryRow}
                            onPress={() => selectCountry(item.code)}
                            activeOpacity={0.7}
                        >
                            <View style={styles.countryInfo}>
                                <Text style={styles.flag}>{flag}</Text>
                                <Text style={styles.countryName}>{item.name}</Text>
                            </View>
                            {isSelected && (
                                <Ionicons name="checkmark-circle" size={22} color={broadcastTheme.colors.sky400} />
                            )}
                        </TouchableOpacity>
                    );
                }}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
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
        marginRight: 40,
    },
    headerSpacer: {
        width: 40,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: broadcastTheme.radii.lg,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
        paddingHorizontal: 12,
        marginHorizontal: 16,
        marginVertical: 12,
        height: 44,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: broadcastTheme.colors.slate50,
        paddingVertical: 8,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    countryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginBottom: 8,
        backgroundColor: broadcastTheme.colors.slate900,
        borderRadius: broadcastTheme.radii.lg,
        borderWidth: 1,
        borderColor: broadcastTheme.colors.borderDefault,
    },
    countryInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    flag: {
        fontSize: 24,
        lineHeight: 28,
    },
    countryName: {
        fontSize: 15,
        fontWeight: '500' as '500',
        color: broadcastTheme.colors.slate50,
    },
});
