const supabase = require('../config/supabase');

const checkHealth = async (req, res) => {
    try {
        const { error } = await supabase
            .from('devices')
            .select('id')
            .limit(1);

        if (error) {
            throw error;
        }

        return res.status(200).json({
            success: true,
            message: 'Backend connected to Supabase successfully',
            database: 'connected'
        });

    } catch (error) {
        console.error('Database connection error:', error.message);

        return res.status(500).json({
            success: false,
            message: 'Cannot connect to Supabase'
        });
    }
};

module.exports = {
    checkHealth
};